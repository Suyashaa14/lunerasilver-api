import { Request, Response, NextFunction } from "express";

export const notFound = (_req: Request, res: Response) => {
  res.status(404).json({ status: false, message: "Route not found" });
};

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
) => {
  console.error(err);

  let statusCode = err.status || err.statusCode || 500;
  let message = err.message || "Internal server error";

  if (err.code === "ER_DUP_ENTRY" || err.errno === 1062) {
    statusCode = 409;
    message = "A record with this value already exists.";
  } else if (err.code === "ER_ROW_IS_REFERENCED_2" || err.errno === 1451) {
    statusCode = 400;
    message = "This record cannot be deleted because it is still in use.";
  } else if (err.code === "ER_NO_REFERENCED_ROW_2" || err.errno === 1452) {
    statusCode = 400;
    message = "Reference check failed: the related record does not exist.";
  } else if (err.sql) {
    message = "A database error occurred while processing your request.";
  }

  res.status(statusCode).json({ status: false, message });
};
