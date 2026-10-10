# Prior art and precedents

Dawai Dost is not a new, untested idea. Three programmes have already shown that frequent stock visibility at the facility level reduces stockouts. Dawai Dost takes the same approach and makes it easier with voice AI and bounded AI decisions.

## SMS for Life, Tanzania

**What it did.** Each week, 129 health facilities in three rural districts received an automatic text message. Staff replied with their stock of antimalarial medicines. District managers used the data to move and order stock.

**Results.** The 21-week pilot ran from October 2009 to February 2010.[^sms-pilot]

| Measure | Result |
| --- | --- |
| Average weekly response rate | **95%** (never below 93%) |
| Facilities without at least one antimalarial dosage | **78% → 26%** |
| Artemether-lumefantrine stock across the three districts | **+64%** |
| Quinine stock across the three districts | **+36%** |

**What we learned.**

- Health workers answer a simple weekly request at a very high rate.
- When managers can see the data, they act on it, and stockouts fall fast.
- The national rollout showed that visibility cannot replace supply. When national supply was below forecast demand, shortages continued.[^sms-scale] For this reason, Dawai Dost includes `draft_indent` and `escalate_supply_gap`, not only transfers.

**What Dawai Dost improves.** SMS for Life needed staff to type a coded message. Dawai Dost uses a natural voice conversation in Hindi. The AI can also ask a follow-up question when a number looks wrong.

## eVIN, India

**What it does.** The Electronic Vaccine Intelligence Network (eVIN) was launched in 2014 by the Ministry of Health and Family Welfare with UNDP. Cold-chain staff record vaccine stock on smartphones. Programme managers see stock and storage temperature from the national level down to the last cold-chain point.

**Results.** Programme partners report that eVIN reduced vaccine stockouts by about **80%** and reduced the time to replenish stock by more than half.[^evin]

**What we learned.** eVIN proves that the Indian public health system can adopt facility-level digital stock visibility at national scale, and that it works. Dawai Dost applies the same idea to essential medicines at PHCs. It uses a phone call instead of a smartphone app, so it needs less hardware and less training.

## India Hypertension Control Initiative (IHCI)

**What it does.** IHCI combines standard treatment protocols, forecasting, procurement support, and stock tools for hypertension medicines.

**Results.** Participating facilities kept amlodipine stockouts **below 5%** during the study period.[^ihci]

**What we learned.** Good forecasting and stock monitoring, inside a strong programme, can keep a chronic-disease medicine on the shelf in Indian public facilities. Dawai Dost gives districts a lightweight version of the forecasting and monitoring parts.

## Summary

| Programme | Channel | Scale | Stockout effect |
| --- | --- | --- | --- |
| SMS for Life | Weekly SMS | 129 facilities (pilot) | 78% → 26% of facilities with a gap |
| eVIN | Smartphone app | National | About 80% fewer vaccine stockouts (reported) |
| IHCI | Programme with stock tools | Participating districts | Amlodipine stockouts below 5% |
| **Dawai Dost** | **Voice call + Decisions API** | **Prototype** | **Designed to bring the same visibility to PHC essential medicines** |

Each programme confirms one part of the Dawai Dost design: frequent reporting, facility-level visibility, and forecasting with a response. Dawai Dost combines all three and adds two things that are now possible with OpenAI: reporting by voice in local languages, and a structured AI recommendation for the next step.

[^sms-pilot]: [SMS for Life: Tanzania pilot](https://pmc.ncbi.nlm.nih.gov/articles/PMC2978233/)
[^sms-scale]: [SMS for Life: national rollout and medicine supply gaps](https://pmc.ncbi.nlm.nih.gov/articles/PMC4030285/)
[^evin]: [Sabin Vaccine Institute: Digitized supply chain delivers vaccines to the last mile](https://sabin.org/resources/digitized-supply-chain-delivers-vaccines-to-the-last-mile-2) and [JSI: Assessing India's Electronic Vaccine Intelligence Network](https://jsi.com/?p=15445)
[^ihci]: [India Hypertension Control Initiative: availability of antihypertensive medicines](https://pmc.ncbi.nlm.nih.gov/articles/PMC10721057/)
