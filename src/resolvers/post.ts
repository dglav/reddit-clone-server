import { MyContext } from "./../types";
import {
  Arg,
  Ctx,
  Field,
  FieldResolver,
  InputType,
  Int,
  Mutation,
  ObjectType,
  Query,
  Resolver,
  Root,
  UseMiddleware,
} from "type-graphql";
import { Post } from "./../entities/Post";
import { Updoot } from "../entities/Updoot";
import { isAuth } from "../middleware/isAuth";
import { getConnection } from "typeorm";
import { TEXT_SNIPPET_LENGTH } from "./constants";

@InputType()
class PostInput {
  @Field()
  title: string;
  @Field()
  text: string;
}

@ObjectType()
class PaginatedPosts {
  @Field(() => [Post])
  posts: Post[];
  @Field()
  hasMore: boolean;
}

@Resolver(Post)
export class PostResolver {
  @FieldResolver(() => String)
  textSnippet(@Root() root: Post) {
    return `${root.text.slice(0, 100)}${
      root.text.length > TEXT_SNIPPET_LENGTH ? "..." : ""
    }`;
  }

  @Mutation(() => Boolean)
  @UseMiddleware([isAuth])
  async vote(
    @Arg("postId", () => Int) postId: number,
    @Arg("value", () => Int) value: number,
    @Ctx() { req }: MyContext
  ) {
    const isUpdoot = value !== -1;
    const realValue = isUpdoot ? 1 : -1;
    const { userId } = req.session;
    const updoot = await Updoot.findOne({ where: { postId, userId } });

    if (updoot && updoot.value !== realValue) {
      // the user has voted on the post before
      // and they are changing their vote
      await getConnection().transaction(async (transactionManager) => {
        await transactionManager.query(
          `
        UPDATE updoot 
        SET value = $1
        WHERE "postId" = $2 AND "userId" = $3;
        `,
          [realValue, postId, userId]
        );
        await transactionManager.query(
          `
        UPDATE post p
        SET points = points + $2
        WHERE p.id = $1;
        `,
          [postId, realValue * 2]
        );
      });
    } else if (!updoot) {
      // the user has never voted before
      await getConnection().transaction(async (transactionManager) => {
        await transactionManager.query(
          `
        INSERT INTO updoot ("userId", "postId", value)
        VALUES ($1, $2, $3);
        `,
          [userId, postId, realValue]
        );

        await transactionManager.query(
          `
        UPDATE post p
        SET points = points + $2
        WHERE p.id = $1;
        `,
          [postId, realValue]
        );
      });
    }
    return true;
  }

  @Query(() => PaginatedPosts)
  async posts(
    @Arg("limit", () => Int) limit: number,
    @Arg("cursor", () => String, { nullable: true }) cursor: string | null
  ): Promise<PaginatedPosts> {
    const realLimit = Math.min(50, limit);
    const realLimitPlusOne = Math.min(50, limit) + 1;

    const replacements: any[] = [realLimitPlusOne];
    if (cursor) {
      replacements.push(new Date(parseInt(cursor)));
    }

    const posts = await getConnection().query(
      `
      SELECT p.*, 
      json_build_object(
        'id', u.id,
        'username', u.username,
        'email', u.email,
        'createdAt', u."createdAt",
        'updatedAt', u."updatedAt"
        ) creator
      FROM post p
      INNER JOIN public.user u on u.id = p."creatorId"
      ${cursor ? `WHERE p."createdAt" < $2` : ""}
      ORDER BY p."createdAt" DESC
      LIMIT $1
    `,
      replacements
    );

    return {
      posts: posts.slice(0, realLimit),
      hasMore: posts.length === realLimitPlusOne,
    };
  }

  @Query(() => Post, { nullable: true })
  post(@Arg("id") id: number): Promise<Post | undefined> {
    return Post.findOne(id);
  }

  @Mutation(() => Post)
  @UseMiddleware(isAuth)
  async createPost(
    @Arg("input") input: PostInput,
    @Ctx() { req }: MyContext
  ): Promise<Post> {
    return Post.create({
      ...input,
      points: 0,
      creatorId: req.session.userId,
    }).save();
  }

  @Mutation(() => Post, { nullable: true })
  async updatePost(
    @Arg("id") id: number,
    @Arg("title") title: string
  ): Promise<Post | null> {
    const post = await Post.findOne({ id });
    if (!post) {
      return null;
    }
    if (title) {
      await Post.update({ id }, { title });
    }
    return post;
  }

  @Mutation(() => Boolean)
  async deletePost(@Arg("id") id: number): Promise<boolean> {
    try {
      await Post.delete({ id });
    } catch (error) {
      console.error(error);
      return false;
    }
    return true;
  }
}
