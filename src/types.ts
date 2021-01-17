import { IDatabaseDriver, Connection, EntityManager } from "@mikro-orm/core";
import Redis from "ioredis";
import { Request, Response } from "express";

export type MyContext = {
  em: EntityManager<any> & EntityManager<IDatabaseDriver<Connection>>;
  redis: Redis.Redis;
  req: Request & { session: { userId?: number } };
  res: Response;
};
