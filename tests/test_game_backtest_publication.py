"""Execute the actual backtest writer against isolated Git remotes."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

WORKFLOW = Path(__file__).resolve().parents[1] / '.github/workflows/game-picks-backtest.yml'


def publication_script():
    lines = WORKFLOW.read_text().splitlines()
    start = lines.index('      - name: Commit audited results') + 1
    while lines[start] != '        run: |':
        start += 1
    output = []
    for line in lines[start + 1:]:
        if line and not line.startswith('          '):
            break
        output.append(line[10:])
    return '\n'.join(output) + '\n'


class GameBacktestPublicationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.remote = self.root / 'remote.git'
        self.work = self.root / 'backtest'
        self.env = dict(os.environ, GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL=os.devnull)
        self.git('init', '--quiet', '--bare', '--initial-branch=main', str(self.remote))
        self.git('clone', '--quiet', str(self.remote), str(self.work))
        self.configure(self.work)
        self.write(self.work, 'nfl_engine.py', {'version': 'reviewed-main'})
        self.write(self.work, 'data/game_picks_backtest.json', {'run': 'original'})
        self.original_records = {'records': [{'id': 'frozen-before', 'score': 91, 'line': 24.5}]}
        self.write(self.work, 'data/game_score_forecasts.json', self.original_records)
        self.git('add', '.', cwd=self.work)
        self.git('commit', '--quiet', '-m', 'Reviewed main', cwd=self.work)
        self.git('push', '--quiet', 'origin', 'HEAD:main', cwd=self.work)

    def git(self, *args, cwd=None):
        return subprocess.run(['git', *args], cwd=cwd or self.root, env=self.env,
                              text=True, capture_output=True, check=True).stdout

    def configure(self, root):
        self.git('config', 'user.name', 'Backtest publication test', cwd=root)
        self.git('config', 'user.email', 'backtest-test@example.invalid', cwd=root)

    @staticmethod
    def write(root, name, value):
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value))

    def published(self, name):
        return json.loads(self.git('--git-dir=' + str(self.remote), 'show', 'main:' + name))

    def remote_head(self):
        return self.git('--git-dir=' + str(self.remote), 'rev-parse', 'main').strip()

    def publish(self, ref='refs/heads/main', event='push'):
        return subprocess.run(['bash', '-e', '-c', publication_script()], cwd=self.work,
                              env=dict(self.env, GITHUB_REF=ref, GITHUB_EVENT_NAME=event),
                              text=True, capture_output=True)

    def feature_checkout(self):
        self.git('switch', '--quiet', '-c', 'feature/unmerged', cwd=self.work)
        self.write(self.work, 'nfl_engine.py', {'version': 'unmerged-feature'})
        self.git('add', 'nfl_engine.py', cwd=self.work)
        self.git('commit', '--quiet', '-m', 'Unmerged feature', cwd=self.work)
        self.write(self.work, 'data/game_picks_backtest.json', {'run': 'generated-on-feature'})

    def concurrent_writer(self, conflict=False):
        other = self.root / 'main-writer'
        self.git('clone', '--quiet', str(self.remote), str(other))
        self.configure(other)
        self.write(other, 'nfl_engine.py', {'version': 'newer-reviewed-main'})
        records = {'records': self.original_records['records'] + [{'id': 'new-frozen', 'score': 85, 'line': 19.5}]}
        self.write(other, 'data/game_score_forecasts.json', records)
        if conflict:
            self.write(other, 'data/game_picks_backtest.json', {'run': 'newer-main-results'})
        self.git('add', '.', cwd=other)
        self.git('commit', '--quiet', '-m', 'New reviewed main and frozen records', cwd=other)
        self.git('push', '--quiet', 'origin', 'HEAD:main', cwd=other)
        return records

    def test_feature_push_manual_and_pr_contexts_never_publish_unmerged_code(self):
        self.feature_checkout()
        remote_before = self.remote_head()
        local_before = self.git('rev-parse', 'HEAD', cwd=self.work).strip()
        for ref, event in [('refs/heads/feature/unmerged', 'push'),
                           ('refs/heads/feature/unmerged', 'workflow_dispatch'),
                           ('refs/pull/126/merge', 'pull_request'),
                           ('refs/heads/main', 'pull_request')]:
            with self.subTest(ref=ref, event=event):
                result = self.publish(ref, event)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(self.remote_head(), remote_before)
                self.assertEqual(self.git('rev-parse', 'HEAD', cwd=self.work).strip(), local_before)
                self.assertEqual(self.published('nfl_engine.py'), {'version': 'reviewed-main'})
                self.assertEqual(self.published('data/game_picks_backtest.json'), {'run': 'original'})
                self.assertEqual(self.published('data/game_score_forecasts.json'), self.original_records)

    def test_main_event_cannot_publish_an_unmerged_checkout_even_if_ref_is_misreported(self):
        self.feature_checkout()
        before = self.remote_head()
        result = self.publish()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('not merged into main', result.stderr)
        self.assertEqual(self.remote_head(), before)

    def test_main_publication_updates_only_results_and_preserves_concurrent_code_and_records(self):
        self.write(self.work, 'data/game_picks_backtest.json', {'run': 'new-backtest'})
        records = self.concurrent_writer()
        result = self.publish()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.published('data/game_picks_backtest.json'), {'run': 'new-backtest'})
        self.assertEqual(self.published('nfl_engine.py'), {'version': 'newer-reviewed-main'})
        self.assertEqual(self.published('data/game_score_forecasts.json'), records)
        changed = self.git('--git-dir=' + str(self.remote), 'diff-tree', '--no-commit-id', '--name-only', '-r', 'main').splitlines()
        self.assertEqual(changed, ['data/game_picks_backtest.json'])

    def test_manual_main_publication_and_noop_are_supported(self):
        before = self.remote_head()
        unchanged = self.publish(event='workflow_dispatch')
        self.assertEqual(unchanged.returncode, 0, unchanged.stderr)
        self.assertEqual(self.remote_head(), before)
        self.write(self.work, 'data/game_picks_backtest.json', {'run': 'manual-main'})
        result = self.publish(event='workflow_dispatch')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.published('data/game_picks_backtest.json'), {'run': 'manual-main'})
        self.assertEqual(self.published('nfl_engine.py'), {'version': 'reviewed-main'})
        self.assertEqual(self.published('data/game_score_forecasts.json'), self.original_records)

    def test_conflicting_results_fail_visibly_without_overriding_newer_main(self):
        self.write(self.work, 'data/game_picks_backtest.json', {'run': 'local-results'})
        records = self.concurrent_writer(conflict=True)
        before = self.remote_head()
        result = self.publish()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('conflicted with newer main data', result.stderr)
        self.assertEqual(self.remote_head(), before)
        self.assertEqual(self.published('data/game_picks_backtest.json'), {'run': 'newer-main-results'})
        self.assertEqual(self.published('data/game_score_forecasts.json'), records)
        self.assertFalse((self.work / '.git/rebase-merge').exists())


if __name__ == '__main__':
    unittest.main()
