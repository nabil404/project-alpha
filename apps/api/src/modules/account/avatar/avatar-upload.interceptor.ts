import { AVATAR_MAX_BYTES } from '@app/shared';
import { ImageUploadInterceptor } from '../../../common/image-upload.interceptor';

export const AvatarUploadInterceptor = ImageUploadInterceptor({
  maxBytes: AVATAR_MAX_BYTES,
  tooLargeCode: 'AVATAR_TOO_LARGE',
  invalidCode: 'AVATAR_INVALID',
  noun: 'image',
});
