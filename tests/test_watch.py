import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
import watch

FIXTURES = Path(__file__).parent / "fixtures"


def load(name):
    return (FIXTURES / name).read_text(encoding="utf-8")


class ParseTest(unittest.TestCase):
    def test_day_with_vacancy(self):
        slots = watch.parse_slots(load("day_with_vacancy.html"))
        self.assertEqual(len({s["facility"] for s in slots}), 11)
        self.assertEqual(sum(s["status"] == "○" for s in slots), 63)
        self.assertEqual(sum(s["status"] == "×" for s in slots), 126)
        keys = watch.open_slot_keys(slots)
        # 柏ビレジ: 7-9時は割当なし、最初のコマが 9-11時
        self.assertIn("柏ビレジ近隣センター|テニスコート B|9:00-11:00", keys)
        self.assertIn("柏ビレジ近隣センター|テニスコート B|15:00-17:00", keys)
        # 大津ヶ丘: 7時から始まる
        self.assertIn("大津ヶ丘中央公園運動場|庭球場人工芝１面|7:00-9:00", keys)

    def test_full_day_has_no_vacancy(self):
        slots = watch.parse_slots(load("day_full.html"))
        self.assertTrue(slots)
        self.assertEqual(watch.open_slot_keys(slots), [])

    def test_unexpected_page_raises(self):
        with self.assertRaises(watch.SiteError):
            watch.parse_slots("<html><body>メンテナンス中</body></html>")

    def test_message(self):
        text = watch.format_message({"2026-10-25": ["柏の葉庭球場|庭球場人工芝３面|9:00-11:00"]})
        self.assertIn("10/25(日)", text)
        self.assertIn("柏の葉庭球場", text)
        self.assertIn("庭球場人工芝３面 9:00-11:00", text)


if __name__ == "__main__":
    unittest.main()
