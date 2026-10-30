# Groceries — our monthly list

A PWA for the family's monthly groceries: one shared list per month with quantity and price, tick items at the shop, and everyone's phone updates live.

## What's set up
- **Database**: Supabase project `ramani-meds` (shared with the medicine and Sankalp apps; their tables are untouched). Tables `gr_households`, `gr_members`, `gr_months`, `gr_items`.
- **Security**: everyone signs in with an email code. Rows are only visible to members of the same family (row-level security via `gr_my_households()`).
- **Live sync**: Supabase Realtime on `gr_items`, `gr_months`, `gr_members`, plus presence for the "N live" count.
- **Copy last month**: `gr_start_month()` creates a month and copies the repeating items of an earlier month (skipping names already on the list). Ticks are cleared; quantities and prices carry over.

## Custom domain
`CNAME` points GitHub Pages at **groceries.balendu.me**. At your DNS provider add:
`CNAME  groceries  →  balendus.github.io`

Supabase → Authentication → URL Configuration → add `https://groceries.balendu.me` to **Redirect URLs** so the link in the sign-in email opens the app (typing the 6-digit code works either way).

## Install on the phones
- **iPhone**: open the link in Safari → Share → *Add to Home Screen*.
- **Android**: open in Chrome → *Install app*.
- **Family**: tap the avatars → *Share invite link* → they open it, sign in with their email, enter their name.
