# Fortell pipeline rebuild

An independent rebuild of the signal pipeline in the Fortell AI hearing aid. I build it from public sources to understand how the hearing aid works.

**Live:** https://fortell-demo-hoeksema.vercel.app

- **Sources:** Fortell's site and blog, HearingTracker, Fortell's patents, and the FCC filing.
- **Not affiliated with Fortell.**

## Site

`web/` is a static site with no build step. All facts and sources are in `web/data.js`.

```
cd web && python3 -m http.server 8000   # run locally
cd web && vercel deploy --prod --yes    # deploy
```

Made by [John Hoeksema](https://johnhoeksema.com).
