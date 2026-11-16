"""Evidence publication must stay bounded as the frozen history grows."""
import contextlib
import datetime as dt
import gzip
import io
import json
import pathlib
import random
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

from scripts import archive_nba_evidence as archive


class NBAEvidenceArchiveTests(unittest.TestCase):
    def test_incremental_shards_preserve_order_and_encode_each_row_once(self):
        rng = random.Random(647)
        rows = [{'captured_at': str(index), 'sources': {'verified': rng.randbytes(4000).hex()}} for index in range(35)]
        with mock.patch.object(archive.json, 'dumps', wraps=json.dumps) as encode:
            shards = list(archive.iter_encoded_shards(rows, limit=16000))
            self.assertEqual(encode.call_count, len(rows), 'Growing prefixes must never be serialized repeatedly')
        self.assertGreater(len(shards), 1)
        decoded = []
        for shard in shards:
            self.assertLess(len(shard), 16000)
            self.assertEqual(shard[4:8], b'\0' * 4, 'Gzip timestamp must remain deterministic')
            payload = json.loads(gzip.decompress(shard))
            self.assertEqual(payload['schema_version'], 3)
            decoded.extend(payload['snapshots'])
        self.assertEqual(decoded, rows)
        self.assertEqual(shards, list(archive.iter_encoded_shards(rows, limit=16000)))

    def test_exact_size_limit_is_rejected_and_empty_history_is_rejected(self):
        row = {'captured_at': '2026-11-01T00:00:00Z', 'sources': {'sample': [1, 2, 3]}}
        encoded = list(archive.iter_encoded_shards([row]))[0]
        self.assertEqual(list(archive.iter_encoded_shards([row], limit=len(encoded) + 1)), [encoded])
        with self.assertRaisesRegex(ValueError, 'Single capture exceeds shard limit'):
            list(archive.iter_encoded_shards([row], limit=len(encoded)))
        with self.assertRaisesRegex(ValueError, 'No evidence'):
            list(archive.iter_encoded_shards([]))

    def test_publish_preserves_first_seen_forecasts_and_all_source_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            data = root / 'data'
            data.mkdir()
            first = {'capture_id': 'original', 'game_id': 'game1', 'model': 'fixed', 'locked_at': '2026-11-01T01:00:00Z',
                     'tipoff': '2026-11-01T03:00:00Z', 'home': 110.25, 'away': 109.5, 'home_win': .54,
                     'baseline': {'home': 107, 'away': 108}, 'input_timestamps': {'games': '2026-11-01T00:00:00Z'},
                     'uncertain': ['player-id'], 'warnings': ['verified caution'], 'redundant_payload': 'excluded by established compaction'}
            original_row = {'captured_at': '2026-11-01T01:01:00Z', 'sources': {
                'nba_simulator_locks': {'snapshots': [first]},
                'nba_injuries': {'generated_at': '2026-11-01T00:00:00Z', 'injuries': [{'player': 'Actual player', 'status': 'OUT'}], 'source': 'redundant metadata'},
                'nba_market_odds': {'generated_at': '2026-11-01T00:59:00Z', 'markets': [{'price': -110, 'line': 215.5}]},
            }, 'evidence_type': 'capture_not_verified_closing_line'}
            later = {'capture_id': 'new', 'game_id': 'game2', 'locked_at': '2026-11-02T01:00:00Z', 'home': 100, 'away': 99}
            (data / 'nba_evidence_archive.json').write_text(json.dumps({'snapshots': [original_row]}))
            (data / 'nba_simulator_locks.json').write_text(json.dumps({'snapshots': [first, {**first, 'home': 999}, later]}))
            (data / 'nba_injuries.json').write_text(json.dumps({'generated_at': '2026-11-02T00:00:00Z', 'injuries': [{'player': 'Actual player', 'status': 'ACTIVE'}]}))
            (data / 'nba_market_odds.json').write_text(json.dumps({'markets': [{'price': 130, 'line': 219.5}]}))
            (data / 'nba_evidence_9999.json.gz').write_bytes(b'obsolete shard')
            with contextlib.redirect_stdout(io.StringIO()):
                manifest = archive.publish(root, dt.datetime(2026, 11, 2, 1, 1, tzinfo=dt.timezone.utc))
            rows = archive.load_archive(data)['snapshots']
            self.assertEqual(manifest['snapshot_count'], 2)
            self.assertEqual(rows[0]['captured_at'], original_row['captured_at'])
            self.assertEqual(rows[0]['sources']['nba_simulator_locks']['snapshots'], [archive.compact_lock(first)])
            self.assertEqual(rows[1]['sources']['nba_simulator_locks']['snapshots'], [archive.compact_lock(later)])
            self.assertEqual(rows[0]['sources']['nba_market_odds'], original_row['sources']['nba_market_odds'])
            self.assertEqual(rows[0]['sources']['nba_injuries']['injuries'], original_row['sources']['nba_injuries']['injuries'])
            self.assertEqual(rows[1]['sources']['nba_market_odds'], {'markets': [{'price': 130, 'line': 219.5}]})
            self.assertEqual((data / 'nba_evidence_archive.json.gz').read_bytes(), (data / manifest['shards'][0]).read_bytes())
            self.assertFalse((data / 'nba_evidence_9999.json.gz').exists())
            self.assertTrue(all((data / name).stat().st_size < archive.SHARD_LIMIT for name in manifest['shards']))

    def test_unchanged_evidence_keeps_capture_timestamp_and_existing_window(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            data = root / 'data'
            data.mkdir()
            rows = [{'captured_at': str(index), 'sources': {'nba_injuries': {'generated_at': str(index), 'injuries': []}}} for index in range(241)]
            (data / 'nba_evidence_archive.json').write_text(json.dumps({'snapshots': rows}))
            (data / 'nba_injuries.json').write_text(json.dumps(rows[-1]['sources']['nba_injuries']))
            with contextlib.redirect_stdout(io.StringIO()):
                archive.publish(root, dt.datetime(2026, 11, 16, tzinfo=dt.timezone.utc))
            self.assertEqual(archive.load_archive(data)['snapshots'], rows[-240:])
            (data / 'nba_injuries.json').write_text(json.dumps({'generated_at': 'new', 'injuries': []}))
            with contextlib.redirect_stdout(io.StringIO()):
                archive.publish(root, dt.datetime(2026, 11, 16, tzinfo=dt.timezone.utc))
            published = archive.load_archive(data)['snapshots']
            self.assertEqual(len(published), 240)
            self.assertEqual(published[:-1], rows[-239:])
            self.assertEqual(published[-1]['sources']['nba_injuries']['generated_at'], 'new')

    def test_manifest_rejects_unsafe_missing_or_incomplete_shards(self):
        with tempfile.TemporaryDirectory() as directory:
            data = pathlib.Path(directory)
            for manifest, reason in [({'shards': ['../nba_evidence_escape.json.gz'], 'snapshot_count': 1}, 'Invalid evidence shard'),
                                     ({'shards': ['nba_evidence_missing.json.gz'], 'snapshot_count': 1}, 'Missing evidence shard'),
                                     ({'shards': [], 'snapshot_count': 1}, 'Evidence count mismatch')]:
                with self.subTest(reason=reason):
                    (data / 'nba_evidence_manifest.json').write_text(json.dumps(manifest))
                    with self.assertRaisesRegex(ValueError, reason):
                        archive.load_archive(data)

    def test_oversized_new_capture_does_not_replace_last_good_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            data = root / 'data'
            data.mkdir()
            original = list(archive.iter_encoded_shards([{'captured_at': 'original', 'sources': {}}]))[0]
            target = data / 'nba_evidence_archive.json.gz'
            target.write_bytes(original)
            large = random.Random(647).randbytes(4000).hex()
            (data / 'nba_injuries.json').write_text(json.dumps({'generated_at': 'new', 'injuries': [{'source_evidence': large}]}))
            encode = archive.iter_encoded_shards
            with mock.patch.object(archive, 'iter_encoded_shards', side_effect=lambda rows: encode(rows, limit=200)):
                with self.assertRaisesRegex(ValueError, 'Single capture exceeds shard limit'):
                    archive.publish(root, dt.datetime(2026, 11, 16, tzinfo=dt.timezone.utc))
            self.assertEqual(target.read_bytes(), original)
            self.assertFalse((data / 'nba_evidence_manifest.json').exists())
            self.assertFalse((data / 'nba_evidence_0000.json.gz').exists())

    def test_import_does_not_publish_or_load_the_real_archive(self):
        probe = subprocess.run([sys.executable, '-c', "import runpy; runpy.run_path(" + repr(str(pathlib.Path(archive.__file__))) + ", run_name='evidence_import_probe')"], capture_output=True, text=True, check=True)
        self.assertEqual(probe.stdout, '')
        self.assertEqual(probe.stderr, '')


if __name__ == '__main__':
    unittest.main()
