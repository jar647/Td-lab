"""Guard against publishing UFC cache files after a failed upstream refresh."""
import pathlib
import unittest


class UFCRefreshWorkflowTests(unittest.TestCase):
    def test_publication_requires_successful_sources_and_validation(self):
        workflow = pathlib.Path(".github/workflows/refresh-ufc.yml").read_text()
        self.assertIn("id: fetch", workflow)
        self.assertIn("id: history", workflow)
        self.assertIn("id: validate", workflow)
        publish = workflow.split("- name: Commit refreshed public statistics only", 1)[1]
        condition = publish.split("\n", 3)[1]
        for required in (
            "success()",
            "steps.fetch.outcome == 'success'",
            "steps.history.outcome == 'success'",
            "steps.validate.outcome == 'success'",
        ):
            with self.subTest(required=required):
                self.assertIn(required, condition)


if __name__ == "__main__":
    unittest.main()
