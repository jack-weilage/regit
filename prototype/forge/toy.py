"""The toy target project (a tiny pricing package with tests) and the scripted demo scenes."""
import re
from pathlib import Path

from .gitx import run, short
from .lander import Forbidden, ScriptedAgent

POLICY = """\
version: 1
default: { lane: flag, require: [tests, combined-tests] }
rules:
  - match: ["docs/**", "**/*.md"]
    lane: auto
    require: [tests, combined-tests]
  - match: ["shop/*.py"]
    lane: auto
    require: [tests, combined-tests]
  - match: ["tests/**"]
    lane: flag                       # lands now; opens a post.review card
    require: [tests, combined-tests]
  - match: ["shop/billing/**"]
    lane: decide
    require: [tests, combined-tests]
    approvers: { count: 1, from: ["@payments"] }
  - match: [".forge/**"]
    lane: decide                     # the gate itself is governed separately
    require: [tests, combined-tests]
    approvers: { count: 1, from: ["@maintainers"] }
groups: { "@payments": ["carol@demo.dev", "erin@demo.dev"], "@maintainers": ["dana@demo.dev", "carol@demo.dev"] }
limits: { max_proof_rounds: 2, max_handbacks: 2, lease_seconds: 900 }
"""

SEED = {
    ".forge/policy.yaml": POLICY,
    "README.md": "# toy shop\n\nTrunk for the landing-layer prototype.\n",
    "shop/__init__.py": "",
    "shop/catalog.py": '"""Product catalog."""\n\nPRODUCTS = {\n    "apple": 1.00,\n    "pear": 1.50,\n}\n\n\n'
                       'def price_of(name):\n    return PRODUCTS[name]\n',
    "shop/pricing.py": '"""Pricing rules."""\n\nTAX_RATE = 0.10\n\n\ndef subtotal(items):\n'
                       '    return sum(item["price"] * item["qty"] for item in items)\n\n\n'
                       'def discount(amount, code):\n    if code == "SAVE10":\n        return round(amount * 0.90, 2)\n'
                       '    return amount\n\n\ndef total(items, code=None):\n'
                       '    return round(discount(subtotal(items), code) * (1 + TAX_RATE), 2)\n',
    "shop/billing/__init__.py": "",
    "shop/billing/invoice.py": '"""Invoice rendering (protected path)."""\nfrom shop.pricing import total\n\n\n'
                               'def invoice_line(items, code=None):\n    return "TOTAL %.2f" % total(items, code)\n',
    "tests/test_pricing.py": 'import unittest\n\nfrom shop.billing.invoice import invoice_line\nfrom shop.catalog import price_of\n'
                             'from shop.pricing import subtotal, total\n\nCART = [{"price": 1.00, "qty": 2}, {"price": 1.50, "qty": 1}]\n\n\n'
                             'class PricingTest(unittest.TestCase):\n'
                             '    def test_subtotal(self):\n        self.assertEqual(subtotal(CART), 3.50)\n\n'
                             '    def test_total_with_tax(self):\n        self.assertEqual(total(CART), 3.85)\n\n'
                             '    def test_save10(self):\n        self.assertEqual(total(CART, "SAVE10"), 3.47)\n\n'
                             '    def test_price_lookup(self):\n        self.assertEqual(price_of("pear"), 1.50)\n\n'
                             '    def test_invoice(self):\n        self.assertEqual(invoice_line(CART), "TOTAL 3.85")\n',
}

RETURN_AMOUNT = "    return amount\n"


def edit(rel, old, new):
    def patch(root):
        p = Path(root) / rel
        text = p.read_text()
        assert text.count(old) == 1, f"anchor not unique in {rel}: {old!r}"
        p.write_text(text.replace(old, new))
    return patch


def write(rel, text):
    def patch(root):
        (Path(root) / rel).parent.mkdir(parents=True, exist_ok=True)
        (Path(root) / rel).write_text(text)
    return patch


def code_block(code, expr):
    return edit("shop/pricing.py", RETURN_AMOUNT, f'    if code == "{code}":\n        return {expr}\n' + RETURN_AMOUNT)


# ---- scene 1: disjoint changes, both auto-land ----
def scene_disjoint(f):
    a = f.spawn(f.intent("Add banana to the catalog", "Sell bananas at 0.25.", "alice@demo.dev", ["shop/catalog.py"]),
                ScriptedAgent([("Add banana at 0.25 to PRODUCTS",
                                edit("shop/catalog.py", '    "pear": 1.50,\n', '    "pear": 1.50,\n    "banana": 0.25,\n'))]))
    b = f.spawn(f.intent("Document discount codes", "Explain SAVE10 to support staff.", "bob@demo.dev", ["docs/**"]),
                ScriptedAgent([("Write docs/discounts.md",
                                write("docs/discounts.md", "# Discount codes\n\n- SAVE10: 10% off before tax\n"))]))
    a.run(), b.run()
    return {"threads": [a, b], "results": f.lander.drain()}


# ---- scene 2: textual conflict -> hand-back -> re-derive from intent ----
WELCOME_TEST = ('import unittest\n\nfrom shop.pricing import total\n\n\nclass WelcomeTest(unittest.TestCase):\n'
                '    def test_welcome5(self):\n        self.assertEqual(total([{"price": 10.0, "qty": 1}], "WELCOME5"), 5.5)\n')


def scene_textual(f):
    c = f.spawn(f.intent("Add HALF code", "Code HALF halves the pre-tax amount.", "alice@demo.dev", ["shop/pricing.py"]),
                ScriptedAgent([("Add HALF branch to discount()", code_block("HALF", "round(amount * 0.50, 2)"))]))
    d = f.spawn(f.intent("Add WELCOME5 code", "Code WELCOME5 takes 5 off pre-tax, floored at 0.", "bob@demo.dev",
                         ["shop/pricing.py", "tests/test_welcome.py"]),
                ScriptedAgent([("Add WELCOME5 branch to discount()", code_block("WELCOME5", "round(max(amount - 5, 0), 2)")),
                               ("Add a test for WELCOME5", write("tests/test_welcome.py", WELCOME_TEST))]))
    c.run(), d.run()
    return {"threads": [c, d], "results": f.lander.drain()}


# ---- scene 3 (headline): clean text merge, each green alone, red together ----
def promo_steps(fn):
    src = ('"""Bundle promotions."""\nfrom shop.pricing import %s, subtotal\n\n\ndef bundle_total(items, code=None):\n'
           '    """3-for-2: every third unit of a line is free."""\n'
           '    free = sum(item["price"] * (item["qty"] // 3) for item in items)\n'
           '    return %s(subtotal(items) - free, code)\n') % (fn, fn)
    test = ('import unittest\n\nfrom shop.promo import bundle_total\n\n\nclass PromoTest(unittest.TestCase):\n'
            '    def test_three_for_two(self):\n        self.assertEqual(bundle_total([{"price": 2.0, "qty": 3}]), 4.0)\n')
    return [(f"Add shop/promo.py: 3-for-2 bundle pricing on pricing.{fn}()", write("shop/promo.py", src)),
            ("Add tests for bundle pricing", write("tests/test_promo.py", test))]


def rederive_promo(agent, th, packet):
    """Re-derive from intent: read the winner's diff in the packet, find the renamed symbol, rebuild on it."""
    renames = {}
    for w in packet["winners"]:
        renames.update(zip(re.findall(r"^-def (\w+)\(", w["diff"], re.M), re.findall(r"^\+def (\w+)\(", w["diff"], re.M)))
    fn = renames.get("discount", "discount")
    th.say("agent", f"Packet: \"{packet['winners'][0]['intent']['title']}\" renamed discount() -> {fn}(). "
                    f"Re-deriving bundle pricing on main {short(packet['newBase'])} against {fn}().")
    agent.work(th, promo_steps(fn))


def scene_semantic(f):
    e = f.spawn(f.intent("Rename discount() to apply_code()", "Clearer name for code-based discounts.", "alice@demo.dev",
                         ["shop/pricing.py"]),
                ScriptedAgent([("Rename discount -> apply_code and update its caller",
                                lambda root: (edit("shop/pricing.py", "def discount(", "def apply_code(")(root),
                                              edit("shop/pricing.py", "round(discount(", "round(apply_code(")(root)))]))
    p = f.spawn(f.intent("3-for-2 bundle pricing", "Every third unit of a line is free.", "bob@demo.dev",
                         ["shop/promo.py", "tests/test_promo.py"]),
                ScriptedAgent(promo_steps("discount"), rederive=rederive_promo))
    e.run(), p.run()
    return {"threads": [e, p], "results": f.lander.drain()}


# ---- scene 4: decide lane; approver must differ from requester ----
def scene_decide(f, approvers=("carol@demo.dev", "dana@demo.dev", "erin@demo.dev")):
    g = f.spawn(f.intent("Thank-you footer on invoices", "Invoices end with a thank-you line.", "carol@demo.dev",
                         ["shop/billing/**"]),
                ScriptedAgent([("Add invoice_footer()", edit("shop/billing/invoice.py", 'total(items, code)\n',
                                                             'total(items, code)\n\n\ndef invoice_footer(name):\n'
                                                             '    return "Thank you, %s!" % name\n'))]))
    g.agent.work(g)
    push = run(g.fork, "push", "origin", "HEAD:refs/heads/main")  # custody: a thread cannot write main
    f.log("custody", f"{g.id} tries `git push origin HEAD:main` -> "
                     f"{'REJECTED: ' + push.stderr.strip().splitlines()[0].strip() if push.returncode else 'accepted (BUG)'}")
    status = g.ready()
    dec = next(d for d in reversed(list(f.decisions.values())) if d["threadId"] == g.id)
    answers = []
    for who_ in approvers:
        try:
            f.answer(dec["id"], who_)
            answers.append((who_, "approved"))
        except Forbidden as e:
            answers.append((who_, f"403 {e}"))
            f.log("decide", f"{who_} tries to approve {dec['id']} -> 403 {e}")
        if dec["status"] != "open":
            break
    return {"threads": [g], "status": status, "decision": dec, "answers": answers, "push_rc": push.returncode,
            "results": f.lander.drain()}


# ---- scene 5: intent claims -> overlap warning at spawn; base_moved -> early re-sync, no hand-back ----
def scene_claims(f):
    after_pear = '    "pear": 1.50,\n'
    h = f.spawn(f.intent("Add kiwi to the catalog", "Sell kiwis at 0.40.", "alice@demo.dev", ["shop/catalog.py::PRODUCTS"]),
                ScriptedAgent([("Add kiwi at 0.40 to PRODUCTS", edit("shop/catalog.py", after_pear, after_pear + '    "kiwi": 0.40,\n'))]))
    i = f.spawn(f.intent("Add grape to the catalog", "Sell grapes at 2.00.", "bob@demo.dev", ["shop/catalog.py::PRODUCTS"]),
                ScriptedAgent([("Add grape at 2.00 to PRODUCTS", edit("shop/catalog.py", after_pear, after_pear + '    "grape": 2.00,\n'))]))
    j = f.spawn(f.intent("FAQ page", "Answer common questions.", "carol@demo.dev", ["docs/faq.md"]),
                ScriptedAgent([("Write docs/faq.md", write("docs/faq.md", "# FAQ\n\nQ: Do codes stack? A: No.\n"))]))
    for th in (h, i, j):
        th.agent.work(th)  # drafts on their forks; nothing submitted yet
    h.ready()
    results = f.lander.drain()
    resynced = {}
    for th in (i, j):  # threads act on base_moved before submitting, instead of finding out at landing
        if any(ev["type"] == "base_moved" for ev in th.inbox):
            resynced[th.id] = th.resync()
            f.log(th.id[:7], f"re-synced early on base_moved -> {resynced[th.id]} onto main {short(th.base)}")
    i.ready(), j.ready()
    results += f.lander.drain()
    return {"threads": [h, i, j], "results": results, "resynced": resynced}
