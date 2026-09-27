# Official government job notices

This repository collects **public recruitment notices** from official Indian government websites: commissions, selection boards, police, districts and panchayats, India Post, railways, banks and PSUs.

- Every two hours a GitHub Actions workflow (`.github/workflows/collect.yml`) runs `collect.mjs`.
- Sites count as official only if they are on `.gov.in` / `.nic.in`, or listed in the Government of India's directory at [igod.gov.in](https://igod.gov.in).
- Notice texts are saved to `notices/` (`index.json` lists them). `notices/domains.json` is the official-website list.

The repository contains no secrets and no personal data. All content is public text published by government bodies.
