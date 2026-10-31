import { Router } from "express";
import { z } from "zod";
import { authenticate, currentUser } from "../../middleware/auth";
import { createLimiters } from "../../middleware/rate-limit";
import { email } from "../../lib/validation";
import { logout, requestCode, verifyCode } from "./auth.service";

const requestCodeSchema = z.object({ email });
const verifySchema = z.object({ email, code: z.string().regex(/^\d{6}$/, "Code must be 6 digits") });

export function createAuthRouter(limiters: ReturnType<typeof createLimiters>) {
  const router = Router();

  router.post(
    "/auth/request-code",
    limiters.codeRequestByIp,
    limiters.codeRequestByEmail,
    async (req, res) => {
      const body = requestCodeSchema.parse(req.body);
      await requestCode(body.email);
      res.status(202).json({ message: "If the email is registered, a code has been sent" });
    },
  );

  router.post("/auth/verify", limiters.codeVerifyByIp, async (req, res) => {
    const body = verifySchema.parse(req.body);
    res.json(await verifyCode(body.email, body.code));
  });

  router.post("/auth/logout", authenticate, async (req, res) => {
    await logout(req.headers.authorization!.slice(7).trim());
    res.status(204).end();
  });

  router.get("/auth/me", authenticate, (req, res) => {
    res.json(currentUser(req));
  });

  return router;
}
