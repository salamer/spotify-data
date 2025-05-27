import {
  Body,
  Get,
  Post,
  Route,
  Tags,
  Security,
  Request,
  Path,
  Query,
  Controller,
  Res,
  TsoaResponse,
  SuccessResponse,
} from "tsoa";
import { AppDataSource } from "./models";
import { MusicPost, User } from "./models";
import { uploadBase64ToObjectStorage } from "./objectstorage.service";
import type { JwtPayload } from "./utils";

export interface CreatePostBase64Input {
  imageBase64: string;
  imageFileType: string;
  musicBase64: string;
  musicFileType: string;
  caption: string;
}

export interface PostResponse {
  id: number;
  coverImageUrl: string;
  musicUrl: string;
  caption: string | null;
  createdAt: Date;
  userId: number;
  username: string;
  avatarUrl: string | null;
}

@Route("music-posts")
@Tags("Music Posts")
export class MusicPostController extends Controller {
  @Security("jwt")
  @Post("")
  @SuccessResponse(200, "Post Created")
  public async createPost(
    @Request() req: Express.Request,
    @Body() body: CreatePostBase64Input,
    @Res() badRequestResponse: TsoaResponse<400, { message: string }>,
    @Res() serverErrorResponse: TsoaResponse<500, { message: string }>
  ): Promise<PostResponse> {
    const currentUser = req.user as JwtPayload;

    if (!body.imageBase64 || !body.imageFileType.startsWith("image/")) {
      return badRequestResponse(400, {
        message: "imageBase64 and a valid imageFileType are required.",
      });
    }

    let base64Data = body.imageBase64;
    const prefixMatch = body.imageBase64.match(/^data:(image\/\w+);base64,/);
    if (prefixMatch) {
      base64Data = body.imageBase64.substring(prefixMatch[0].length);
    }

    if (body.musicBase64 && body.musicFileType) {
      if (!body.musicFileType.startsWith("audio/")) {
        return badRequestResponse(400, {
          message: "musicFileType must be a valid audio type.",
        });
      }
    }

    let musicBase64Data = body.musicBase64;
    if (body.musicBase64) {
      const musicPrefixMatch = body.musicBase64.match(
        /^data:(audio\/\w+);base64,/
      );
      if (musicPrefixMatch) {
        musicBase64Data = body.musicBase64.substring(
          musicPrefixMatch[0].length
        );
      }
    }

    if (!musicBase64Data || !body.musicFileType) {
      return badRequestResponse(400, {
        message: "musicBase64 is required when musicFileType is provided.",
      });
    }

    try {
      const uploadResult = await uploadBase64ToObjectStorage(
        base64Data,
        body.imageFileType
      );

      const musicUploadResult = await uploadBase64ToObjectStorage(
        musicBase64Data,
        body.musicFileType
      );

      const postRepo = AppDataSource.getRepository(MusicPost);
      const newPost = postRepo.create({
        userId: currentUser.userId,
        coverImageUrl: uploadResult.objectUrl,
        audioUrl: musicUploadResult.objectUrl,
        caption: body.caption || null,
      });
      const savedPost = await postRepo.save(newPost);

      const user = await AppDataSource.getRepository(User).findOneBy({
        id: currentUser.userId,
      });

      this.setStatus(200);
      return {
        ...savedPost,
        coverImageUrl: uploadResult.objectUrl,
        musicUrl: musicUploadResult.objectUrl,
        caption: newPost.caption,
        username: user?.username || "unknown",
        avatarUrl: user?.avatarUrl || null,
        createdAt: newPost.createdAt,
        id: newPost.id,
        userId: newPost.userId,
      };
    } catch (error: any) {
      console.error("Post creation failed:", error);
      return serverErrorResponse(500, {
        message: error.message || "Failed to create post.",
      });
    }
  }

  @Get("")
  public async getFeedPosts(
    @Query() limit: number = 10,
    @Query() offset: number = 0
  ): Promise<PostResponse[]> {
    const posts = await AppDataSource.getRepository(MusicPost).find({
      relations: ["user"],
      order: { createdAt: "DESC" },
      take: limit,
      skip: offset,
    });

    return posts.map((post) => ({
      id: post.id,
      coverImageUrl: post.coverImageUrl,
      musicUrl: post.audioUrl,
      caption: post.caption,
      createdAt: post.createdAt,
      userId: post.userId,
      username: post.user?.username || "unknown",
      avatarUrl: post.user?.avatarUrl || null,
    }));
  }

  @Get("search")
  public async searchPosts(
    @Query() query: string,
    @Query() limit: number = 10,
    @Query() offset: number = 0,
    @Res() badRequestResponse: TsoaResponse<400, { message: string }>
  ): Promise<PostResponse[]> {
    if (!query.trim()) {
      return badRequestResponse(400, {
        message: "Search query cannot be empty",
      });
    }
    const searchTerm = query.trim().split(/\s+/).join(" & ");

    const posts = await AppDataSource.getRepository(MusicPost)
      .createQueryBuilder("music_posts")
      .leftJoinAndSelect("music_posts.user", "user")
      .where("to_tsvector(music_posts.caption) @@ plainto_tsquery(:query)", {
        query: searchTerm,
      })
      .orderBy("music_posts.createdAt", "DESC")
      .take(limit)
      .skip(offset)
      .getMany();

    return posts.filter(
      (post) => post.user !== null && post.caption !== null
    ).map((post) => ({
      id: post.id,
      coverImageUrl: post.coverImageUrl,
      musicUrl: post.audioUrl,
      caption: post.caption,
      createdAt: post.createdAt,
      userId: post.userId,
      username: post.user?.username || "unknown",
      avatarUrl: post.user?.avatarUrl || null,
    }));
  }

  @Get("{postId}")
  public async getPostById(
    @Path() postId: number,
    @Res() notFoundResponse: TsoaResponse<404, { message: string }>
  ): Promise<PostResponse> {
    const post = await AppDataSource.getRepository(MusicPost).findOne({
      where: { id: postId },
      relations: ["user"],
    });

    if (!post) {
      return notFoundResponse(404, { message: "Post not found" });
    }

    return {
      id: post.id,
      coverImageUrl: post.coverImageUrl,
      musicUrl: post.audioUrl,
      caption: post.caption,
      createdAt: post.createdAt,
      userId: post.userId,
      username: post.user?.username || "unknown",
      avatarUrl: post.user?.avatarUrl || null,
    };
  }
}
