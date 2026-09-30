import { useState } from 'react';
import {
  PRODUCT_IMAGE_ACCEPTED_TYPES,
  PRODUCT_IMAGE_MAX_BYTES,
  PRODUCT_IMAGE_MAX_COUNT,
  type ErrorCode,
  type ProductImage,
} from '@app/shared';

import { useErrorMessages } from '@/i18n/error-keys';

import { useUploadProductImage } from './queries';

const acceptedTypes: readonly string[] = PRODUCT_IMAGE_ACCEPTED_TYPES;
export const photoAccept = PRODUCT_IMAGE_ACCEPTED_TYPES.join(',');

/** The checks the API makes that the browser can make first, so a wrong file never leaves it. */
export function checkPhotoFile(file: File): ErrorCode | null {
  if (!acceptedTypes.includes(file.type)) return 'PRODUCT_IMAGE_UNSUPPORTED_TYPE';
  if (file.size > PRODUCT_IMAGE_MAX_BYTES) return 'PRODUCT_IMAGE_TOO_LARGE';
  return null;
}

/** One photo, uploaded straight away: the variant image picker's "Upload a new image". */
export function usePhotoUpload(productId: string, currentCount: number) {
  const upload = useUploadProductImage(productId);
  const { forCode, forError } = useErrorMessages();
  const [error, setError] = useState<string | null>(null);

  const uploadFile = async (file: File): Promise<ProductImage | null> => {
    setError(null);
    if (currentCount >= PRODUCT_IMAGE_MAX_COUNT) {
      setError(forCode('PRODUCT_IMAGE_LIMIT_REACHED', { max: PRODUCT_IMAGE_MAX_COUNT }));
      return null;
    }
    const refused = checkPhotoFile(file);
    if (refused) {
      setError(forCode(refused));
      return null;
    }
    try {
      return await upload.mutateAsync({ file });
    } catch (failure) {
      setError(forError(failure));
      return null;
    }
  };

  return { uploadFile, uploading: upload.isPending, error };
}
