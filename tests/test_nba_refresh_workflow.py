"""Exercise the real source-publication step independently of slow NBA research."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

WORKFLOW = Path(__file__).resolve().parents[1] / '.github/workflows/nba-feed.yml'
SOURCE_STEP = 'Publish current NBA sources before derived research'


def step_script(name):
    lines = WORKFLOW.read_text().splitlines()
    start = lines.index('      - name: ' + name) + 1
    if lines[start] != '        run: |':
        raise AssertionError('Expected a shell publication step')
    result = []
    for line in lines[start + 1:]:
        if line and not line.startswith('          '):
            break
        result.append(line[10:])
    return '\n'.join(result) + '\n'


class NBARefreshPublicationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.remote = self.root / 'remote.git'
        self.work = self.root / 'feed-writer'
        self.env = dict(os.environ, GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL=os.devnull)
        self.git('init', '--quiet', '--bare', '--initial-branch=main', str(self.remote))
        self.git('clone', '--quiet', str(self.remote), str(self.work))
        self.configure(self.work)
        for name in ('nba_games', 'nba_rosters', 'nba_season_stats', 'nba_injuries', 'nba_game_context'):
            self.write(self.work, 'data/' + name + '.json', {'generated_at': 'original'})
        self.original_lock = {'picks': [{'id': 'frozen-pick', 'score': 91, 'line': 24.5, 'capturedAt': 'original'}]}
        self.write(self.work, 'data/recommendations/ledger.json', self.original_lock)
        self.git('add', '.', cwd=self.work)
        self.git('commit', '--quiet', '-m', 'Original published data', cwd=self.work)
        self.git('push', '--quiet', 'origin', 'HEAD:main', cwd=self.work)

    def git(self, *args, cwd=None):
        return subprocess.run(['git', *args], cwd=cwd or self.root, env=self.env,
                              text=True, capture_output=True, check=True).stdout

    def configure(self, root):
        self.git('config', 'user.name', 'Refresh integration test', cwd=root)
        self.git('config', 'user.email', 'refresh-test@example.invalid', cwd=root)

    @staticmethod
    def write(root, name, value):
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value))

    def published(self, name):
        return json.loads(self.git('--git-dir=' + str(self.remote), 'show', 'main:' + name))

    def publish_sources(self):
        return subprocess.run(['bash', '-e', '-c', step_script(SOURCE_STEP)], cwd=self.work,
                              env=self.env, text=True, capture_output=True, check=True)

    def test_sources_publish_before_archive_failure_without_replacing_newer_availability(self):
        # The feed writer has fresh core sources in its older checkout.
        for name in ('nba_games', 'nba_rosters', 'nba_season_stats'):
            self.write(self.work, 'data/' + name + '.json', {'generated_at': 'fresh-source'})
        # A separate writer publishes newer availability during the feed fetch.
        other = self.root / 'availability-writer'
        self.git('clone', '--quiet', str(self.remote), str(other))
        self.configure(other)
        for name in ('nba_injuries', 'nba_game_context'):
            self.write(other, 'data/' + name + '.json', {'generated_at': 'newer-availability'})
        self.git('add', '.', cwd=other)
        self.git('commit', '--quiet', '-m', 'New availability', cwd=other)
        self.git('push', '--quiet', 'origin', 'HEAD:main', cwd=other)

        self.publish_sources()
        # A later failure must leave the already published source commit intact.
        failure = subprocess.run(['bash', '-c', 'exit 23'], cwd=self.work, env=self.env)
        self.assertEqual(failure.returncode, 23)
        for name in ('nba_games', 'nba_rosters', 'nba_season_stats'):
            self.assertEqual(self.published('data/' + name + '.json'), {'generated_at': 'fresh-source'})
        for name in ('nba_injuries', 'nba_game_context'):
            expected = {'generated_at': 'newer-availability'}
            self.assertEqual(self.published('data/' + name + '.json'), expected)
            self.assertEqual(json.loads((self.work / 'data' / (name + '.json')).read_text()), expected)
        self.assertEqual(self.published('data/recommendations/ledger.json'), self.original_lock)
        changed = self.git('--git-dir=' + str(self.remote), 'diff-tree', '--no-commit-id', '--name-only', '-r', 'main').splitlines()
        self.assertEqual(set(changed), {'data/nba_games.json', 'data/nba_rosters.json', 'data/nba_season_stats.json'})
        workflow = WORKFLOW.read_text()
        self.assertLess(workflow.index('- name: ' + SOURCE_STEP), workflow.index('python scripts/archive_nba_evidence.py'))

    def test_unchanged_sources_do_not_create_an_empty_commit(self):
        before = self.git('--git-dir=' + str(self.remote), 'rev-parse', 'main').strip()
        self.publish_sources()
        self.assertEqual(self.git('--git-dir=' + str(self.remote), 'rev-parse', 'main').strip(), before)


if __name__ == '__main__':
    unittest.main()
