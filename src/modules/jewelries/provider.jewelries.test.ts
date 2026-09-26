import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { unguardedDb } from "../../utils/db";
import { listJewelries } from "./provider.jewelries";

const MARK = "__jw_pub_test__";

const wipe = async () => {
  await unguardedDb("inventory_transactions")
    .whereIn("jewelry_id", unguardedDb("jewelries").where("sku", "like", `${MARK}%`).select("id"))
    .del();
  await unguardedDb("jewelries").where("sku", "like", `${MARK}%`).del();
};

before(async () => {
  await wipe();
  for (const status of ["available", "reserved", "sold", "damaged", "lost", "voided"]) {
    await unguardedDb("jewelries").insert({
      sku: `${MARK}-${status}`, name: `${MARK} ${status}`, category: "rings", material: "silver",
      silver_weight_grams: 5, making_charge: 100, status,
    });
  }
});

after(async () => { await wipe(); await unguardedDb.destroy(); });

// This endpoint is public. A shopper must never be shown something that has
// left the shelf -- they could add it to a cart and only find out at checkout.
test("the public listing hides anything not for sale", async () => {
  const res = await listJewelries({ page: 1, pageSize: 200 });
  const mine = res.data.filter((r: any) => String(r.name).startsWith(MARK));

  const statuses = mine.map((r: any) => r.status).sort();
  assert.deepEqual(statuses, ["available", "reserved"], `a shopper could see: ${statuses.join(", ")}`);
});

test("an explicit status filter still works, for staff screens", async () => {
  const res = await listJewelries({ status: "damaged", page: 1, pageSize: 200 });
  const mine = res.data.filter((r: any) => String(r.name).startsWith(MARK));
  assert.equal(mine.length, 1);
  assert.equal(mine[0].status, "damaged");
});
