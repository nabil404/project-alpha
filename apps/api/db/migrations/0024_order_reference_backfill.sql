-- Orders are now numbered from 1 each calendar year, the year read in the
-- shop's time zone (Asia/Dhaka, the default region's, for a shop with no
-- settings row yet). Existing orders are renumbered within their year in the
-- order they were placed, and given the reference the API now stores:
-- ORD-<year>-<number padded to 5 digits, never truncated>.
-- 0023 dropped the shop-wide number constraint first, or a renumbered row
-- could collide mid-update with one not yet renumbered.
WITH numbered AS (
  SELECT
    o.id,
    y.year,
    row_number() OVER (PARTITION BY o.merchant_id, y.year ORDER BY o.placed_at, o.number, o.id) AS number
  FROM "order" o
  LEFT JOIN merchant_settings s ON s.merchant_id = o.merchant_id
  CROSS JOIN LATERAL (
    SELECT extract(year FROM o.placed_at AT TIME ZONE coalesce(s.time_zone, 'Asia/Dhaka'))::integer AS year
  ) y
)
UPDATE "order" o
SET
  year = n.year,
  number = n.number,
  reference = 'ORD-' || n.year || '-' || CASE
    WHEN n.number < 100000 THEN lpad(n.number::text, 5, '0')
    ELSE n.number::text
  END
FROM numbered n
WHERE o.id = n.id;
