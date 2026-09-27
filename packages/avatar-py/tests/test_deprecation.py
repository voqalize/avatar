"""The package says it is deprecated, on import, in a way a consumer's test
run reports."""

import importlib
import warnings

import voqalize_avatar


def test_import_warns_that_the_package_is_deprecated():
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        importlib.reload(voqalize_avatar)
    messages = [str(w.message) for w in caught if w.category is DeprecationWarning]
    assert any("voqalize-avatar is deprecated" in m for m in messages), messages
