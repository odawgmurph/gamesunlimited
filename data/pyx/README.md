# Pretend You're Xyzzy card data

`cah_cards.sql` is copied unchanged from
[ajanata/PretendYoureXyzzy](https://github.com/ajanata/PretendYoureXyzzy/blob/master/cah_cards.sql)
(commit `10525012`). It is a PostgreSQL dump of the official Cards Against
Humanity cards through Q3 2017 (black cards, white cards and the sets they belong to).

`scripts/build-cah-cards.mjs` turns it into `public/games/insanity/pyx-cards.json`,
which Cards with Insanity loads at runtime. It runs automatically before
`npm run dev` and `npm run build`.

**License.** The card text is from Cards Against Humanity, which is licensed
[CC BY-NC-SA 2.0](https://creativecommons.org/licenses/by-nc-sa/2.0/). The
file header says: *"Pretend You're Xyzzy cards by Andy Janata is licensed under
a Creative Commons Attribution-NonCommercial-ShareAlike 3.0 Unported License.
Based on a work at www.cardsagainsthumanity.com."* Keep the card data
non-commercial and credited.
