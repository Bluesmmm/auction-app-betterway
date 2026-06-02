import { Module } from "@nestjs/common";
import { ChildParticipationService } from "../accounts/child-participation.service.js";
import { AccountsModule } from "../accounts/accounts.module.js";
import { SessionService } from "../accounts/session.service.js";
import { SessionTokenService } from "../accounts/session-token.service.js";
import { CommunitiesModule } from "../communities/communities.module.js";
import { CommunityAdminAuthorizationService } from "../communities/community-admin-authorization.service.js";
import { PrismaModule } from "../prisma/prisma.module.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { FakeContentSafetyProvider } from "../providers/fake-providers.js";
import { ContentController } from "./content.controller.js";
import { ContentFileAccessService } from "./content-file-access.service.js";
import { ContentReviewService } from "./content-review.service.js";
import { ContentVisibilityService } from "./content-visibility.service.js";
import { MediaUploadService } from "./media-upload.service.js";

const stage3ObjectGrantSigningKey = "stage3-object-grant-key";

@Module({
  imports: [PrismaModule, AccountsModule, CommunitiesModule],
  controllers: [ContentController],
  providers: [
    {
      provide: FakeContentSafetyProvider,
      useFactory: () => new FakeContentSafetyProvider()
    },
    {
      provide: MediaUploadService,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new MediaUploadService(prisma)
    },
    {
      provide: ContentReviewService,
      inject: [
        PrismaService,
        ChildParticipationService,
        CommunityAdminAuthorizationService,
        FakeContentSafetyProvider
      ],
      useFactory: (
        prisma: PrismaService,
        participation: ChildParticipationService,
        adminAuthorizations: CommunityAdminAuthorizationService,
        contentSafety: FakeContentSafetyProvider
      ) =>
        new ContentReviewService(
          prisma,
          participation,
          adminAuthorizations,
          contentSafety
        )
    },
    {
      provide: ContentVisibilityService,
      inject: [PrismaService, ChildParticipationService],
      useFactory: (
        prisma: PrismaService,
        participation: ChildParticipationService
      ) =>
        new ContentVisibilityService(
          prisma,
          participation,
          stage3ObjectGrantSigningKey
        )
    },
    {
      provide: ContentFileAccessService,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new ContentFileAccessService(prisma, stage3ObjectGrantSigningKey)
    }
  ],
  exports: [
    MediaUploadService,
    ContentReviewService,
    ContentVisibilityService,
    ContentFileAccessService
  ]
})
export class ContentModule {}
