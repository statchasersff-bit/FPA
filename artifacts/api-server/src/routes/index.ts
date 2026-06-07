import { Router, type IRouter } from "express";
import healthRouter from "./health";
import nflFpaRouter from "./nfl/fpa";
import adminFpaRouter from "./admin/fpa";

const router: IRouter = Router();

router.use(healthRouter);
router.use(nflFpaRouter);
router.use(adminFpaRouter);

export default router;
