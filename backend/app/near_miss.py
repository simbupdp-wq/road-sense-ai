"""Compatibility import for the selected Vicky branch's candidate analyzer.

The API keeps this module path so its existing imports stay familiar, while
the implementation has a single source of truth in ``roadwatch_engine``.
"""

from backend.roadwatch_engine.src.near_miss import (  # noqa: F401
    DISTANCE_THRESHOLD,
    MIN_CONSECUTIVE_FRAMES,
    RELEVANT_CLASSES,
    analyze_near_misses,
)

__all__ = [
    "DISTANCE_THRESHOLD",
    "MIN_CONSECUTIVE_FRAMES",
    "RELEVANT_CLASSES",
    "analyze_near_misses",
]
