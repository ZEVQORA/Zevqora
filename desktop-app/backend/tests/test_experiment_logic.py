from app.experiments.service import _canonical


def test_canonical_json_order():
    assert _canonical('{"b":2,"a":1}') == _canonical('{"a":1,"b":2}')


def test_canonical_whitespace():
    assert _canonical(" shipping  status ") == _canonical("shipping status")
