import { useTranslation } from 'react-i18next';

/** A customer's name, or a stand-in until Facebook shares their profile. */
export function useCustomerName() {
  const { t } = useTranslation('conversations');
  return (name: string | null): string => name ?? t('customer.unknownName');
}
