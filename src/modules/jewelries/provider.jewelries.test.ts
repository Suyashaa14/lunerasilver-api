import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { unguardedDb } from "../../utils/db";
import { listJewelries, retireJewelry, restoreJewelry, createJewelry, updateJewelry } from "./provider.jewelries";
import { actor, resolveActor } from "../../utils/testActor";

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

// --- Deleting is a status change, so it can be undone ------------------------

// "Entered by mistake" is the easiest thing in the system to click by mistake,
// and before this there was no way back at all.
test("a deleted piece can be put back on the shelf", async () => {
  await resolveActor();
  const [id] = await unguardedDb("jewelries").insert({
    sku: `${MARK}-restore`, name: `${MARK} Restore Me`, category: "rings", material: "silver",
    silver_weight_grams: 5, making_charge: 100, cost_price: 400, status: "available",
  });

  await retireJewelry(id, "voided", "wrong entry", actor);
  assert.equal((await unguardedDb("jewelries").where({ id }).first()).status, "voided");

  const back = await restoreJewelry(id, "put back, it does exist", actor);
  assert.equal(back!.status, "available");

  // The two stock rows have to cancel, or the count is wrong for ever.
  const rows = await unguardedDb("inventory_transactions").where({ jewelry_id: id }).orderBy("id");
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r: any) => r.direction), ["out", "in"]);
  assert.equal(
    rows.reduce((n: number, r: any) => n + (r.direction === "in" ? 1 : -1) * Number(r.quantity), 0),
    0,
    "the piece went off the shelf and came back, so the net movement is nothing",
  );
});

test("a piece on the shelf cannot be restored, and a sold one needs a credit note", async () => {
  await resolveActor();
  const onShelf = await unguardedDb("jewelries").where({ sku: `${MARK}-available` }).first("id");
  await assert.rejects(restoreJewelry(onShelf.id, "no", actor), /already on the shelf/);

  const sold = await unguardedDb("jewelries").where({ sku: `${MARK}-sold` }).first("id");
  await assert.rejects(restoreJewelry(sold.id, "no", actor), /credit note/);
});

// --- Adding a piece by hand --------------------------------------------------

// sku is NOT NULL and UNIQUE, and createJewelry never set it, so every attempt
// to add a piece by hand failed outright with a database error.
test("a piece added by hand gets a code, and keeps what was typed", async () => {
  const made: number[] = [];
  try {
    const a = await createJewelry({
      name: `${MARK} By Hand`, category: "rings", silverWeightGrams: 5,
      pricingMode: "makingCharge", makingCharge: 100, purity: "999", material: "Silver",
    } as any);
    made.push(a!.id);
    assert.match(a!.sku!, /^RIN-\d{4}$/, "a code is generated from the category");
    assert.equal(a!.purity, "999");
    assert.equal(a!.material, "Silver");

    // A second piece must not collide with the first.
    const b = await createJewelry({
      name: `${MARK} By Hand 2`, category: "rings", silverWeightGrams: 5,
      pricingMode: "makingCharge", makingCharge: 100, purity: "98%",
    } as any);
    made.push(b!.id);
    assert.notEqual(b!.sku, a!.sku);

    // Any purity the shop types is kept as typed.
    const edited = await updateJewelry(a!.id, { purity: "92.5%" } as any);
    assert.equal(edited!.purity, "92.5%");
    assert.equal(edited!.sku, a!.sku, "the code must survive an edit; it is on the tag");

    // An edit that does not mention purity must not wipe it.
    const renamed = await updateJewelry(a!.id, { name: `${MARK} Renamed` } as any);
    assert.equal(renamed!.purity, "92.5%");

    await assert.rejects(
      createJewelry({
        name: `${MARK} Clash`, category: "rings", silverWeightGrams: 5,
        pricingMode: "makingCharge", makingCharge: 100, sku: a!.sku,
      } as any),
      /already uses the code/,
    );
  } finally {
    if (made.length > 0) await unguardedDb("jewelries").whereIn("id", made).del();
  }
});
