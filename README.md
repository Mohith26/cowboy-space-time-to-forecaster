# Reason-2 Time-to-Forecaster Planner (concept)

**Live demo:** https://mohith26.github.io/cowboy-space-time-to-forecaster/

An unofficial concept tool for [Cowboy Space](https://www.cowboyspace.com)'s Reason-2 mission. Reason-2 (2027) will run NOAA's Community Satellite Processing Package (CSPP LEO and MiRS) on NVIDIA GPUs in orbit and send the results down a 25 Gbps optical terminal, so forecasters get products faster. Lasers stop at clouds, so the latency a forecaster actually sees depends on which ground stations are in view, whether they are clear, and which link each product rides. This tool computes that, and picks stations that make it fast.

Synthetic weather, assumed station sites and link parameters. Not affiliated with Cowboy Space or NOAA.

## What it does (`core/latency.mjs`, all computed live in the browser)

1. **Orbit and contacts.** Circular sun-synchronous orbit (550 km, 97.6°, LTAN 13:30, period 95.6 min) with Earth rotation and the sun-synchronous node drift. Contact windows for 3 RF stations (5° mask) and 12 candidate optical ground stations (20° mask) over 14 days at 20 s resolution.
2. **Correlated clouds.** Each optical site's clear/cloudy state per hour comes from a Gaussian copula: a latent = √ρ · regional factor + √(1-ρ) · local noise, each an AR(1) with an 8-hour persistence; clear if below the probit of that site's assumed clear fraction. Sites in one weather region (Tenerife and Matera) are correlated; distant sites are not. 120 independent two-week weather histories (60 for choosing stations, 60 held out for reporting).
3. **Time to forecaster.** For every 10-minute data chunk and product (fire alerts 50 KB, MiRS soundings 25 MB, VIIRS imagery + cloud mask 1.5 GB) it computes when the product is on the ground under three pipelines: raw RF downlink at the next polar contact plus 20 min of ground processing (today); onboard processing (4 min) plus laser only; onboard processing plus every link (small products also ride S-band, larger ones X-band, whichever arrives first).
4. **Ground network design.** Lazy greedy selection of extra optical stations maximizing on-time delivery (mean over products of the share delivered within each product's deadline), scored on the training weather and reported on held-out weather; checked against brute force in the tests.

## Results (`node scripts/run.mjs`, held-out weather, MiRS soundings, 30-minute deadline)

| Pipeline | Median | p90 | On time |
|---|---|---|---|
| Raw RF downlink + ground processing (today) | 36 min | 58 min | 37% |
| Onboard + laser only, 3 mid-latitude sites | 3.4 h | 9.2 h | 8% |
| Onboard + every link, same 3 sites | 18 min | 40 min | 72% |
| Onboard + every link, + Troll, Atacama, Hartebeesthoek (optimizer picks) | 15 min | 38 min | 78% |

Clouds block a third of laser passes at the three base sites, and each mid-latitude site only sees Reason-2 about twice a day, so a laser-only downlink to them is slower than today's raw RF path. Polar RF stations see it nearly every orbit, which is why "every link" wins for small products, and why the optimizer prefers high-latitude optical sites (Troll: 7.6 passes/day) over clearer but rarely visited ones. An optical site co-located with an RF station adds nothing for small products.

## Tests

`node --test tests/latency.test.mjs` (8 tests): orbit period and maximum latitude; elevation is 90° overhead and negative on the far side; polar stations see many more passes and windows don't overlap; probit inverts the normal CDF; the cloud model reproduces each site's clear fraction and the regional correlation; every-link delivery is never slower than laser-only and adding a station never hurts; lazy greedy matches brute force on a small instance; committed results reproduce.

## Honest limitations

- **Everything about the ground network is assumed.** Cowboy has not published Reason-2's ground stations, link margins or masks. The 3-site "base" network, clear-sky fractions and regional correlation (ρ = 0.6, 8 h persistence) are plausible climatology-style assumptions, not measured. Real planning should use ERA5/MODIS cloud data per site.
- **Simplified link model.** No link budget, acquisition time, turbulence outages, daytime sky background, or partial clouds; a pass is either clear for its full length or not, decided at its start. Capacity never binds at 25 Gbps for these product sizes (a 1.5 GB product needs half a second), which is why only contact timing matters here.
- **Data flow is idealized.** Data chunks become available onboard every 10 minutes (in the CRADA test NOAA's historical VIIRS data is replayed); onboard CSPP takes a flat 4 minutes and ground processing a flat 20. RF contacts are assumed always available to Reason-2 at the polar sites.
- **Objective is one choice.** Equal weight across products, deadline-based. A different objective (e.g. p90 latency for fire alerts only) can pick different sites.
- **UI.** Cowboy Space has no public operations app, so the page follows the company's website design system (colors, bracketed nav, wordmark, italic eyebrow labels, wide heavy headings). The site's typefaces (Panell, Similar) are licensed; Archivo Expanded and Inter stand in.

## Novelty note

Cowboy's public material (NOAA CRADA announcement, Reason-1/Reason-2 and Big Iron posts) describes onboard processing, a 25 Gbps optical terminal and onboard event detection that sends small alert packets; nothing public models delivered latency under cloud-gated optical contacts or chooses ground stations for it. Optical ground-station site diversity and cloud-aware link planning are studied elsewhere (DLR's reactive optical link planning; Cailabs' 2026 analysis of optical ground networks with weather correlation), and SSEC's direct-broadcast network already gets VIIRS fire products to the ground within about a minute for overhead passes. This tool's contribution is applying that to Reason-2's specific pipeline and showing the laser-only trap with numbers.

Built by Mohith Gajjela (mohithgajjela.com).
