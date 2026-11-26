"""No desktop input or running-app dependence."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "spikes" / "qa"))
from process_attribution import cpu_delta, descendants


class AttributionTests(unittest.TestCase):
    def test_ignores_unrelated_chrome_and_includes_explicit_disjoint_webview_tree(self):
        table = {10:(1,"eonara.exe"),11:(10,"msedgewebview2.exe"),
                 12:(11,"msedgewebview2.exe"),20:(2,"msedgewebview2.exe"),
                 21:(20,"msedgewebview2.exe"),30:(2,"chrome.exe")}
        births = {10:100,11:110,12:120,20:105,21:115,30:1}
        self.assertEqual(descendants(table,births,[10]),{10,11,12})
        self.assertEqual(descendants(table,births,[10,20]),{10,11,12,20,21})

    def test_old_child_does_not_become_a_child_of_reused_parent_pid(self):
        self.assertEqual(descendants({10:(1,"host"),11:(10,"old"),12:(10,"new")},
                                    {10:200,11:100,12:250},[10]),{10,12})

    def test_recycled_pid_is_churn_not_negative_or_inflated_cpu(self):
        before = {10:{"created_100ns":1,"cpu_seconds":3},11:{"created_100ns":5,"cpu_seconds":50}}
        after = {10:{"created_100ns":1,"cpu_seconds":4},11:{"created_100ns":8,"cpu_seconds":2}}
        self.assertEqual(cpu_delta(before,after),(1,[11],[11]))


if __name__ == "__main__":
    unittest.main()
