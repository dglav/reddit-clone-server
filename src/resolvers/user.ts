import argon2 from "argon2";
import {
  Arg,
  Ctx,
  Field,
  InputType,
  Mutation,
  ObjectType,
  Query,
  Resolver,
} from "type-graphql";
import { MyContext } from "./../types";
import { User } from "./../entities/User";

@InputType()
class UsernamePasswordInput {
  @Field()
  username: string;
  @Field()
  password: string;
}

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
    // Check username length
    if (options.username.length <= 2) {
      return {
        errors: [{ field: "username", message: "username is not long enough" }],
      };
    }
    // Check password length
    if (options.password.length <= 3) {
      return {
        errors: [{ field: "password", message: "password is not long enough" }],
      };
    }

    const hashedPassword = await argon2.hash(options.password);
    try {
      const user = em.create(User, {
        username: options.username,
        password: hashedPassword,
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
    @Arg("options") options: UsernamePasswordInput,
    @Ctx() { em, req }: MyContext
  ): Promise<UserResponse> {
    const user = await em.findOne(User, {
      username: options.username,
    });
    if (!user) {
      return {
        errors: [{ field: "username", message: "that username doesn't exist" }],
      };
    }
    const valid = await argon2.verify(user.password, options.password);
    if (!valid) {
      return {
        errors: [{ field: "password", message: "incorrect password" }],
      };
    }

    req.session.userId = user.id;

    return { user };
  }
}
