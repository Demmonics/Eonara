"""Mocked input-guard tests: never invokes SendInput or moves the desktop pointer."""
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "spikes" / "qa"))
import win32


class InputGuardTests(unittest.TestCase):
    def test_unrelated_foreground_hit_is_not_clicked(self):
        with patch.object(win32,"move"),patch.object(win32.time,"sleep"), \
             patch.object(win32,"cursor",return_value=(40,80)), \
             patch.object(win32,"hit_window",return_value={"hit_root":999}), \
             patch.object(win32,"button") as button:
            with self.assertRaisesRegex(RuntimeError,"approved test HWND"):
                win32.gesture((40,80),allowed_roots={123})
            button.assert_not_called()

    def test_coordinate_mismatch_is_not_clicked(self):
        with patch.object(win32,"move"),patch.object(win32.time,"sleep"), \
             patch.object(win32,"cursor",return_value=(41,80)), \
             patch.object(win32,"hit_window",return_value={"hit_root":123}), \
             patch.object(win32,"button") as button:
            with self.assertRaisesRegex(RuntimeError,"Pointer moved"):
                win32.gesture((40,80),allowed_roots={123})
            button.assert_not_called()

    def test_allowed_target_has_paired_release(self):
        with patch.object(win32,"move"),patch.object(win32.time,"sleep"), \
             patch.object(win32,"cursor",return_value=(40,80)), \
             patch.object(win32,"hit_window",return_value={"hit_root":123}), \
             patch.object(win32,"button") as button:
            win32.gesture((40,80),allowed_roots={123})
            self.assertEqual([call.args for call in button.call_args_list],[(True,),(False,)])


if __name__ == "__main__":
    unittest.main()
