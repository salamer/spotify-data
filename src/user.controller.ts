import {
  Post,
  Delete,
  Route,
  Tags,
  Security,
  Request,
  Path,
  Controller,
  Res,
  TsoaResponse,
  Get,
  SuccessResponse,
} from "tsoa";
import { AppDataSource, User, MusicPost, Like } from "./models";
import type { JwtPayload } from "./utils";
import { PostResponse } from "./music-post.controller";
import { In } from "typeorm";

interface UserProfileResponse {
  id: number;
  username: string;
  bio: string | null;
  avatarUrl: string | null;
  createdAt: Date;
}

@Route("users")
@Tags("Users")
export class UserController extends Controller {
  @Get("{userId}/profile")
  public async getUserProfile(
    @Path() userId: number,
    @Res() notFound: TsoaResponse<404, { message: string }>
  ): Promise<UserProfileResponse> {
    const userRepo = AppDataSource.getRepository(User);

    const user = await userRepo.findOneBy({ id: userId });
    if (!user) {
      return notFound(404, { message: "User not found" });
    }

    return {
      id: user.id,
      username: user.username,
      bio: user.bio,
      avatarUrl: user.avatarUrl,
      createdAt: user.createdAt,
    };
  }

  @Security("jwt", ["optional"])
  @Get("{userId}/likes")
  public async getUserLikes(
    @Request() req: Express.Request,
    @Path() userId: number,
    @Res() notFound: TsoaResponse<404, { message: string }>
  ): Promise<PostResponse[]> {
    const user = await AppDataSource.getRepository(User).findOneBy({
      id: userId,
    });
    if (!user) {
      return notFound(404, { message: "User not found" });
    }

    const posts = await AppDataSource.getRepository(MusicPost).find({
      where: { userId },
      relations: ["user"],
    });

    if (posts.length === 0) {
      return notFound(404, { message: "No liked posts found for this user." });
    }

    const currentUser = req.user as JwtPayload;
    const likedPosts =
      currentUser && currentUser.userId
        ? await AppDataSource.getRepository(Like).find({
            where: {
              userId: currentUser.userId,
              postId: In(posts.map((post) => post.id)),
            },
          })
        : [];

    return posts.map((post) => ({
      id: post.id,
      coverImageUrl: post.coverImageUrl,
      musicUrl: post.audioUrl,
      caption: post.caption,
      createdAt: post.createdAt,
      userId: post.userId,
      username: post.user?.username || "unknown",
      avatarUrl: post.user?.avatarUrl || null,
      hasLiked: likedPosts.some((like) => like.postId === post.id),
    }));
  }
}
