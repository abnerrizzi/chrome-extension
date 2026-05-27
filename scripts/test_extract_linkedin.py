#!/usr/bin/env python3
"""Testes do extractor guest do LinkedIn (espelha SEL.GUEST do parser JS).

Roda no host (sem deps): `python3 scripts/test_extract_linkedin.py`
Ou via pytest:           `pytest scripts/test_extract_linkedin.py`
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from extract_linkedin import extract_items, _digits, _id_from_url  # noqa: E402

ONE_CARD = """
<ul class="jobs-search__results-list">
  <li>
    <div class="base-card relative w-full job-search-card" data-entity-urn="urn:li:jobPosting:4405181293">
      <a class="base-card__full-link" href="https://br.linkedin.com/jobs/view/dev-i-at-meta-4405181293?refId=abc">
        <span class="sr-only">Desenvolvedor I</span>
      </a>
      <div class="base-search-card__info">
        <h3 class="base-search-card__title">  Desenvolvedor I  </h3>
        <h4 class="base-search-card__subtitle"><a class="hidden-nested-link">Meta</a></h4>
        <div class="base-search-card__metadata">
          <span class="job-search-card__location">Brazil</span>
          <time class="job-search-card__listdate" datetime="2026-04-27">2 days ago</time>
        </div>
      </div>
    </div>
  </li>
</ul>
"""

NO_TITLE_CARD = """
<div class="base-card job-search-card" data-entity-urn="urn:li:jobPosting:777999111">
  <a class="base-card__full-link" href="https://x/jobs/view/777999111"></a>
</div>
"""


def test_digits_and_id_extraction():
    assert _digits("urn:li:jobPosting:4405181293") == "4405181293"
    assert _id_from_url("https://br.linkedin.com/jobs/view/dev-i-at-meta-4405181293?x=1") == "4405181293"
    assert _id_from_url("/jobs/search?currentJobId=4408106126") == "4408106126"
    assert _digits(None) is None


def test_extract_one_card():
    items = extract_items(ONE_CARD)
    assert len(items) == 1
    c = items[0]
    assert c["external_id"] == "4405181293"
    assert c["title"] == "Desenvolvedor I"          # normalizado (sem espaços)
    assert c["company"] == "Meta"
    assert c["location"] == "Brazil"
    assert c["url"] == "https://br.linkedin.com/jobs/view/dev-i-at-meta-4405181293"  # query removida
    assert c["posted_raw"] == "2026-04-27"           # datetime attr, não o texto relativo
    assert c["source_view"] == "guest"


def test_card_without_title_is_filtered_out():
    assert extract_items(NO_TITLE_CARD) == []


def _main():
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")


if __name__ == "__main__":
    _main()
