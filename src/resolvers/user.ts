import { validateRegister } from "./../utils/validateRegister";
import argon2 from "argon2";
import {
  Arg,
  Ctx,
  Field,
  Mutation,
  ObjectType,
  Query,
  Resolver,
} from "type-graphql";
import { MyContext } from "./../types";
import { User } from "./../entities/User";
import { COOKIE_NAME } from "./../constants";
import { UsernamePasswordInput } from "./UsernamePasswordInput";

@ObjectType()
class FieldError {
  @Field()
  field: string;
  @Field()
  message: string;
}

@ObjectType()
class UserResponse {
  @Field(() => [FieldError], { nullable: true })
  errors?: FieldError[];

  @Field(() => User, { nullable: true })
  user?: User;
}

@Resolver()
export class UserResolver {
  @Query(() => User, { nullable: true })
  async me(@Ctx() { em, req }: MyContext) {
    const id = req.session.userId;
    // You are not logged in
    if (!id) return null;
    // You are logged in
    const user = await em.findOne(User, { id });
    return user;
  }

  @Mutation(() => UserResponse)
  async register(
    @Arg("options") options: UsernamePasswordInput,
    @Ctx() { em, req }: MyContext
  ): Promise<UserResponse> {
    const errors = validateRegister(options);
    if (errors) return { errors };

    const hashedPassword = await argon2.hash(options.password);
    try {
      const user = em.create(User, {
        username: options.username,
        password: hashedPassword,
        email: options.email,
      });
      await em.persistAndFlush(user);

      // Log in the user after registration
      req.session.userId = user.id;

      return { user };
    } catch (error) {
      // duplicate username error
      if (error.code === "23505" || error.detail.includes("already exists")) {
        return {
          errors: [
            { field: "username", message: "that username already exists" },
          ],
        };
      }
      return {
        errors: [
          { field: "unknown", message: "an unknown error has occurred" },
        ],
      };
    }
  }

  @Mutation(() => UserResponse)
  async login(
    @Arg("usernameOrEmail") usernameOrEmail: string,
    @Arg("password") password: string,
    @Ctx() { em, req }: MyContext
  ): Promise<UserResponse> {
    const user = await em.findOne(
      User,
      usernameOrEmail.includes("@")
        ? {
            email: usernameOrEmail,
          }
        : {
            username: usernameOrEmail,
          }
    );
    if (!user) {
      return {
        errors: [
          {
            field: "usernameOrEmail",
            message: "that username/email doesn't exist",
          },
        ],
      };
    }
    const valid = await argon2.verify(user.password, password);
    if (!valid) {
      return {
        errors: [{ field: "password", message: "incorrect password" }],
      };
    }

    req.session.userId = user.id;

    return { user };
  }

  @Mutation(() => Boolean)
  async logout(@Ctx() { req, res }: MyContext) {
    return new Promise((resolve) =>
      req.session.destroy((err) => {
        res.clearCookie(COOKIE_NAME);
        if (err) {
          console.error(err);
          resolve(false);
          return;
        }
        resolve(true);
        return;
      })
    );
  }

  @Mutation(() => Boolean)
  async forgotPassword(@Arg("email") email: string, @Ctx() { em }: MyContext) {
    await em.findOne(User, { email });
    return true;
  }
}
