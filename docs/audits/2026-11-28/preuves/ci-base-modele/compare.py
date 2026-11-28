"""Compares two stamped `unittest -v` logs: each test's outcome, and where the time went.
usage: compare.py before.log after.log"""
import collections, re, sys
ID = re.compile(r"\((test_\w+\.\w+\.\w+)\)")
STATUS = re.compile(r"(?:^| \.\.\. )(ok|FAIL|ERROR|skipped\b.*|expected failure|unexpected success)$")

def read(path):
    out, order, pending, previous, first, summary = {}, [], None, None, None, []
    for raw in open(path, errors="replace"):
        stamp, _, text = raw.rstrip("\n").partition(" ")
        try: when = float(stamp)
        except ValueError: continue
        if first is None: first = previous = when
        if re.match(r"(Ran \d+ tests|OK|FAILED|template_base:|exit )", text): summary.append(text)
        found = ID.search(text)
        if found and " ... " in text: pending = found.group(1)
        done = STATUS.search(text)
        if done and pending:
            out[pending] = (done.group(1).split()[0], when - previous); order.append(pending)
            previous, pending = when, None
    return out, order, summary, (previous - first)

before, order_b, sum_b, total_b = read(sys.argv[1])
after, order_a, sum_a, total_a = read(sys.argv[2])
print("before:", len(before), "tests,", f"{total_b:.0f} s |", " | ".join(sum_b))
print("after: ", len(after), "tests,", f"{total_a:.0f} s |", " | ".join(sum_a))
count = lambda d: dict(collections.Counter(s for s, _ in d.values()))
print("outcomes before:", count(before)); print("outcomes after: ", count(after))
changed = [(t, before[t][0], after[t][0]) for t in before if t in after and before[t][0] != after[t][0]]
print("tests whose outcome changed:", len(changed))
for t, b, a in changed[:40]: print(f"   {b} -> {a}  {t}")
only_b = [t for t in before if t not in after]; only_a = [t for t in after if t not in before]
print("only before:", len(only_b), only_b[:5]); print("only after:", len(only_a), sorted({t.split('.')[0] for t in only_a}))
mod_b, mod_a = collections.Counter(), collections.Counter()
for t, (_, d) in before.items(): mod_b[t.split(".")[0]] += d
for t, (_, d) in after.items(): mod_a[t.split(".")[0]] += d
print("modules, seconds before -> after (largest before):")
for m, d in mod_b.most_common(22): print(f"   {d:7.1f} -> {mod_a.get(m, 0):6.1f}   {m}")
print("slowest modules after:")
for m, d in mod_a.most_common(14): print(f"   {d:6.1f}  (before {mod_b.get(m, 0):6.1f})  {m}")
