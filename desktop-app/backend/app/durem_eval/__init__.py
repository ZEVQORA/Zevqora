"""DUREM <-> ZEVQORA evaluation integration.

Engineering scaffolding for a local-runtime product. Executes real DUREM code
against either a real Lemonade runtime or a deterministic stub, collects
non-USD work metrics, grades deterministic safety gates, diagnoses avoidable
work, and applies reversible optimization candidates.

No component of this package produces a dollar figure, and none may report a
savings percentage derived from the stub runtime.
"""

from .metrics import MetricFidelity, MetricSelection, WorkMetrics, WorkUnitWeights
from .runtime import MockRuntimeServer, RuntimeDescriptor, local_descriptor, probe_local_runtime

__all__ = [
    "MetricFidelity",
    "MetricSelection",
    "MockRuntimeServer",
    "RuntimeDescriptor",
    "WorkMetrics",
    "WorkUnitWeights",
    "local_descriptor",
    "probe_local_runtime",
]
