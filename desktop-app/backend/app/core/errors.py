from __future__ import annotations


class ZevqoraError(Exception):
    """Base error for controlled backend failures."""


class ProviderError(ZevqoraError):
    """Provider request failed after normalization."""


class ProviderTimeoutError(ProviderError):
    """Provider did not respond within the configured timeout."""


class PricingUnavailableError(ZevqoraError):
    """Cost could not be computed from a verified pricing snapshot."""


class MigrationError(ZevqoraError):
    """Database schema migration cannot proceed safely."""


class SubprocessError(ZevqoraError):
    """Safe subprocess execution failed."""


class UnsafeCommandError(SubprocessError):
    """Command string contains shell control syntax or cannot be parsed safely."""
