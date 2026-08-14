import pytest

from athena_api.kiwoom.return_codes import normalize_return_code


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (None, ""),
        ("", ""),
        ("   ", ""),
        ("0000", "0"),
        ("01700", "1700"),
        ("-0007", "-7"),
        (7, "7"),
        ("raw-code", "raw-code"),
        (True, "True"),
        (False, "False"),
    ],
)
def test_normalize_return_code(value: object, expected: str) -> None:
    assert normalize_return_code(value) == expected
