# Launch drafts — Under This Sky

Written 2026-08-12, against commit f9948b4 (planet-label collision fix +
Milky Way blur, both live).

Nick posts these, not an agent: Show HN expects the person who built the
thing to be in the comments, and the questions this will attract (catalogue
provenance, ephemeris accuracy, licensing) are ones he can answer and an
agent shouldn't improvise.

---

## Show HN

**When.** Tuesday–Thursday, 8–10am US Eastern. That is when /newest turns
over fastest and the front page has the longest runway. Avoid Friday,
weekends, and US holidays. Post once — reposting a dead submission is
against the rules and is noticed.

**Be free for the next 4–6 hours.** A Show HN that goes quiet in the
comments dies even with upvotes. Answering the first three questions
quickly matters more than the title.

**Title** (79 chars, no hype, the unusual thing last — HN rewards the
specific detail over the pitch):

    Show HN: The real sky for any date and place – and from the Apollo sites

Alternates if that one feels off:

    Show HN: Under This Sky – the actual night sky for any moment on Earth, Moon or Mars
    Show HN: I computed the night sky in the browser, including from Jezero Crater

**URL:** https://underthissky.net/make.html
(straight to the tool, not the landing page — HN wants the thing itself)

**First comment**, posted immediately after submitting:

> I got tired of "star map" sites that draw a decorative pattern and call
> it your sky, so I built one that computes the real thing.
>
> Pick a date, a time and a place and it works out where every star, the
> Moon and the planets actually were — positions from the HYG catalogue,
> constellation figures from Stellarium's modern sky culture, Milky Way
> isophotes from d3-celestial (BSD-3). The ephemeris runs in the browser;
> I validated it sub-pixel against a Skyfield/JPL DE421 generator I use for
> the print side.
>
> The part I had most fun with: you can stand somewhere other than Earth.
> Tranquility Base and the other Apollo sites, Jezero and Gale on Mars,
> the summit of Olympus Mons. The star field is physically unchanged — only
> the frame moves — so from Mars the pole sits near Deneb instead of
> Polaris, and Earth shows up as a labelled dot whenever it's above the
> horizon.
>
> Free, no account, nothing to install. Disclosure since it'll come up: I
> sell printed versions, but the tool itself is unlimited and I'm not
> gating anything behind the shop.
>
> Known limits: place lookup is Nominatim so obscure place names can miss;
> times are read in the timezone shown, which trips people charting
> somewhere far away; below about magnitude 5 I stop drawing field stars so
> the constellation figures stay readable.

**Questions to expect, and the honest answers:**

- *Which catalogue / how accurate?* HYG, and the sub-pixel validation
  against Skyfield/DE421. Have the number ready.
- *Why not just use Stellarium?* Stellarium is better at being a
  planetarium. This is a one-moment, shareable, no-install artefact — and
  Stellarium doesn't put you on Mars in two taps.
- *Is this AI slop / is it a store?* Disclose the shop up front (above) and
  it stops being a gotcha.
- *Licensing of the catalogue data?* Know the answer before posting.
- *Mobile?* It is mobile-first; make sure it is, on a real phone, before
  you post.

---

## Cloudy Nights

Different audience, different post. They will not care about the print
shop and will care a great deal about accuracy. Post in the software or
general forum, lead with the method, and ask for critique rather than
announcing a product — that community reacts badly to marketing and well
to "tell me where this is wrong."

---

## Pinterest

This is the *product* channel, not the tool channel — it feeds the Etsy
listings, not the sky maker. Worth doing, but separately, and it is a slow
compounding thing rather than a launch.
