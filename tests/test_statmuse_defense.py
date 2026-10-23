import unittest
from scripts.import_statmuse_defense import parse

def table(rows):
    header = "<tr><th>OPP</th><th>GP</th><th>REC YDS</th><th>REC</th><th>TRG</th></tr>"
    return "<table>" + header + "".join(
        f"<tr><td>{name}</td><td>5</td><td>100</td><td>12</td><td>20</td></tr>"
        for name in rows) + "</table>"

class StatMuseImportTests(unittest.TestCase):
    def test_incomplete_table_fails_closed(self):
        with self.assertRaisesRegex(ValueError, "incomplete"):
            parse(table(["Cardinals"]), "WR")

    def test_missing_table_fails_closed(self):
        with self.assertRaisesRegex(ValueError, "exactly one"):
            parse("<html><body>blocked</body></html>", "WR")

    def test_duplicate_team_fails_closed(self):
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            parse(table(["Cardinals", "Cardinals"]), "WR")

if __name__ == "__main__":
    unittest.main()
