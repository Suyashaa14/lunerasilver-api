import type { Knex } from "knex";

/**
 * A small trading chart of accounts.
 *
 * Codes follow the usual convention: 1 assets, 2 liabilities, 3 equity,
 * 4 income, 5 cost of sales, 6 operating expenses. The posting rules in
 * src/modules/ledger/provider.posting.ts look accounts up by these codes, so
 * changing a code means changing those too.
 */
export const ACCOUNTS: { code: string; name: string; type: string }[] = [
  { code: "1000", name: "Cash in hand", type: "asset" },
  { code: "1010", name: "Bank account", type: "asset" },
  { code: "1020", name: "eSewa wallet", type: "asset" },
  { code: "1100", name: "Accounts receivable", type: "asset" },
  { code: "1200", name: "Inventory — jewellery", type: "asset" },
  { code: "1300", name: "VAT receivable (input)", type: "asset" },

  { code: "2000", name: "Accounts payable", type: "liability" },
  { code: "2100", name: "VAT payable (output)", type: "liability" },
  { code: "2200", name: "TDS payable", type: "liability" },

  { code: "3000", name: "Owner's equity", type: "equity" },
  { code: "3900", name: "Retained earnings", type: "equity" },

  { code: "4000", name: "Sales — jewellery", type: "income" },

  { code: "5000", name: "Cost of goods sold", type: "expense" },
  { code: "6000", name: "Operating expenses", type: "expense" },
];

export async function seed(knex: Knex): Promise<void> {
  for (const account of ACCOUNTS) {
    const existing = await knex("accounts").where({ code: account.code }).first();
    if (existing) continue;
    await knex("accounts").insert(account);
    console.log(`Created account ${account.code} ${account.name}`);
  }
}
