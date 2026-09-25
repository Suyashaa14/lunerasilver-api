import express, { Request, Response } from "express";
import { body, validationResult } from "express-validator";
import db from "../../utils/db";
import { upload } from "../../middleware/upload";
import { uploadImageBuffer } from "../../utils/cloudinary";
import { authenticateStaff } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { auditActor, writeAuditLog } from "../../utils/audit";

const router = express.Router();
router.use(authenticateStaff);

const TYPES = ["purchase_bill", "expense_receipt", "payment_proof", "invoice_pdf", "credit_note_pdf", "other"];

const toDTO = (row: any) => ({
  id: row.id,
  documentType: row.document_type,
  referenceType: row.reference_type,
  referenceId: row.reference_id === null ? null : Number(row.reference_id),
  fileName: row.file_name,
  fileUrl: row.file_url,
  mimeType: row.mime_type,
  fileSize: Number(row.file_size),
  uploadedAt: row.created_at,
});

router.get("/", asyncHandler(async (req: Request, res: Response) => {
  const query = db("documents").orderBy("id", "desc").limit(200);
  if (req.query.referenceType) query.where({ reference_type: String(req.query.referenceType) });
  if (req.query.referenceId) query.where({ reference_id: Number(req.query.referenceId) });
  if (req.query.documentType) query.where({ document_type: String(req.query.documentType) });
  res.json((await query).map(toDTO));
}));

/**
 * Stores the evidence behind a row: the supplier's bill, the receipt for the
 * rent, a screenshot of the eSewa transfer. The tax office asks for these; a
 * shoebox works until it does not.
 */
router.post(
  "/",
  upload.single("file"),
  [
    body("documentType").isIn(TYPES).withMessage(`documentType must be one of: ${TYPES.join(", ")}`),
    body("referenceType").optional({ values: "falsy" }).isString().trim().isLength({ max: 40 }),
    body("referenceId").optional({ values: "falsy" }).isInt({ min: 1 }),
  ],
  asyncHandler(async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ status: false, errors: errors.array() });
    if (!req.file) return res.status(400).json({ status: false, message: "A file is required" });

    const uploaded = await uploadImageBuffer(req.file.buffer, "lunerasilver/documents");
    const actor = auditActor(req);

    const id = await db.transaction(async (trx) => {
      const [newId] = await trx("documents").insert({
        document_type: req.body.documentType,
        reference_type: req.body.referenceType || null,
        reference_id: req.body.referenceId ? Number(req.body.referenceId) : null,
        file_name: req.file!.originalname,
        file_url: uploaded.url,
        storage_provider: "cloudinary",
        storage_public_id: uploaded.publicId,
        mime_type: req.file!.mimetype,
        file_size: req.file!.size,
        uploaded_by: actor.userId ?? null,
      });

      // Attaching a receipt to an expense is a change to that expense's record,
      // so the link is made here rather than left to a second call that might
      // never happen.
      if (req.body.referenceType === "expense" && req.body.referenceId) {
        await trx("expenses").where({ id: Number(req.body.referenceId) }).update({ receipt_document_id: newId });
      }

      await writeAuditLog(trx, {
        ...actor, action: "create", entityType: "documents", entityId: newId,
        newValues: { document_type: req.body.documentType, file_name: req.file!.originalname },
      });

      return newId;
    });

    res.status(201).json(toDTO(await db("documents").where({ id }).first()));
  }),
);

// No delete. Evidence is kept; a wrong upload is superseded by a right one.

export default router;
