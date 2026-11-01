from unittest.mock import patch
from django.utils import timezone


def freeze_webinar_clock(test, when):
    clock = patch("flow.webinars.timezone", wraps=timezone)
    frozen = clock.start()
    frozen.now.return_value = when
    test.addCleanup(clock.stop)
    return frozen
