"""Pure identity-aware process attribution and interval accounting.

No fuzzy image-name matching: independent WebView roots require an explicit PID
from the operator and are pinned to their creation timestamp before measurement.
"""
from collections import deque


def descendants(table, identities, roots):
    """Reject a parent edge when its PID now represents a newer process."""
    children = {}
    for pid, (parent, _name) in table.items():
        children.setdefault(parent, []).append(pid)
    included, queue = set(), deque(roots)
    while queue:
        pid = queue.popleft()
        if pid in included or pid not in table or pid not in identities:
            continue
        included.add(pid)
        for child in children.get(pid, []):
            if child in identities and identities[child] >= identities[pid]:
                queue.append(child)
    return included


def cpu_delta(before, after):
    """Count only the same process instances in both samples.

    Interval churn is exposed rather than imputing a terminated process's CPU.
    """
    common = {
        pid for pid in before.keys() & after.keys()
        if before[pid]["created_100ns"] == after[pid]["created_100ns"]
    }
    delta = sum(max(0, after[pid]["cpu_seconds"] - before[pid]["cpu_seconds"]) for pid in common)
    return delta, sorted(after.keys() - common), sorted(before.keys() - common)
