import { Router, type IRouter } from "express";
import healthRouter from "./health";
import nflFpaRouter from "./nfl/fpa";

const router: IRouter = Router();

router.use(healthRouter);
router.use(nflFpaRouter);

export default router;
