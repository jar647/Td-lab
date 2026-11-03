import pathlib,subprocess,tempfile,unittest

class WriterIsolation(unittest.TestCase):
 def test_slow_publication_preserves_fast_availability(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=pathlib.Path(tmp);remote=root/'remote.git';slow=root/'slow';fast=root/'fast'
   def git(*args,cwd=None,ok=True):
    r=subprocess.run(['git',*args],cwd=cwd,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    if ok and r.returncode:raise AssertionError(r.stderr)
    return r
   git('init','--bare','--initial-branch=main',str(remote));git('clone',str(remote),str(slow))
   for repo in [slow]:
    git('config','user.email','test@example.invalid',cwd=repo);git('config','user.name','Test',cwd=repo)
   (slow/'data').mkdir()
   for name in ['nba_games','nba_injuries','nba_game_context']:(slow/'data'/f'{name}.json').write_text('old')
   git('add','data',cwd=slow);git('commit','-m','base',cwd=slow);git('push','origin','main',cwd=slow);git('clone',str(remote),str(fast));git('config','user.email','test@example.invalid',cwd=fast);git('config','user.name','Test',cwd=fast)
   (slow/'data/nba_games.json').write_text('new game records');(slow/'data/nba_injuries.json').write_text('local forecast input');(slow/'data/nba_game_context.json').write_text('local context input')
   git('restore','--worktree','--','data/nba_injuries.json','data/nba_game_context.json',cwd=slow);git('add','data/nba_games.json',cwd=slow);git('commit','-m','completed forecast publication',cwd=slow)
   for name in ['nba_injuries','nba_game_context']:(fast/'data'/f'{name}.json').write_text('newer availability')
   git('add','data',cwd=fast);git('commit','-m','fast availability',cwd=fast);git('push','origin','main',cwd=fast)
   self.assertNotEqual(git('push','origin','main',cwd=slow,ok=False).returncode,0)
   git('fetch','origin','main',cwd=slow);git('rebase','origin/main',cwd=slow);git('push','origin','HEAD:main',cwd=slow)
   self.assertEqual((slow/'data/nba_games.json').read_text(),'new game records')
   self.assertEqual((slow/'data/nba_injuries.json').read_text(),'newer availability')
   self.assertEqual((slow/'data/nba_game_context.json').read_text(),'newer availability')
if __name__=='__main__':unittest.main()
