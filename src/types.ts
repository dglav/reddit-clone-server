import Redis from "ioredis";
import { Request, Response } from "express";
import { createUserLoader } from "./utils/createUserLoader";
import { createUpdootLoader } from "./utils/createUpdootLoader";

export type MyContext = {
  redis: Redis.Redis;
  req: Request & { session: { userId?: number } };
  res: Response;
  userLoader: ReturnType<typeof createUserLoader>;
  updootLoader: ReturnType<typeof createUpdootLoader>;
};
