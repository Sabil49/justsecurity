// services/SubscriptionService.ts
import { Platform } from 'react-native';
import { api } from './api';
import * as IAP from 'react-native-iap';

interface Product {
  productId: string;
  title: string;
  description: string;
  price: string;
  currency: string;
}

interface PurchaseResult {
  productId: string;
  transactionId: string;
  receipt: string;
  signature?: string;
}

class SubscriptionService {
  private readonly PRODUCTS = {
    ios: ['com.antivirus.premium.monthly', 'com.antivirus.premium.yearly'],
    android: ['premium_monthly', 'premium_yearly'],
  };

  async initialize() {
    try {
      await IAP.initConnection();
      console.log('[IAP] Connection established');
    } catch (error) {
      console.error('[IAP_INIT_ERROR]', error);
    }
  }

  async getProducts(): Promise<Product[]> {
    try {
      const platform = Platform.OS as 'ios' | 'android';
      const productIds = this.PRODUCTS[platform];

      const products = await IAP.fetchProducts({ skus: productIds }) as any[];

      return (products ?? []).map(p => {
        const item: any = p;
        return {
          productId: item.productId ?? item.productIdAndroid ?? item.productIdIOS ?? '',
          title: item.title || '',
          description: item.description || '',
          price: typeof item.price === 'number' ? item.price.toString() : (item.price || '0'),
          currency: item.currency || 'USD',
        };
      });
    } catch (error) {
      console.error('[GET_PRODUCTS_ERROR]', error);
      return [];
    }
  }

  async purchase(productId: string): Promise<PurchaseResult> {
    try {
      const purchase = await IAP.requestPurchase({ sku: productId } as any);

      if (!purchase) {
        throw new Error('Purchase cancelled');
      }

      // Extract platform-specific receipt safely
      const receiptData = (purchase as any).transactionReceipt ?? (purchase as any).data ?? (purchase as any).originalJson ?? '';

      // Verify with backend
      const verifyResponse = await api.post('/payment/verify', {
        platform: Platform.OS,
        receiptData,
        productId,
      });

      if (!verifyResponse.data.success) {
        throw new Error('Payment verification failed');
      }

      return {
        productId,
        transactionId: (purchase as any).transactionId ?? (purchase as any).purchaseToken ?? '',
        receipt: receiptData,
        signature: (purchase as any).signatureAndroid ?? (purchase as any).signature ?? '',
      };
    } catch (error) {
      console.error('[PURCHASE_ERROR]', error);
      throw error;
    }
  }

  async restorePurchases(): Promise<number> {
    try {
      const purchases = await IAP.getAvailablePurchases();
      const purchaseList = Array.isArray(purchases) ? purchases : [purchases];

      for (const purchase of purchaseList) {
        // Extract platform-specific receipt safely
        const receiptData = (purchase as any).transactionReceipt ?? (purchase as any).data ?? (purchase as any).originalJson ?? '';

        // Verify each purchase with backend
        await api.post('/payment/verify', {
          platform: Platform.OS,
          receiptData,
          productId: (purchase as any).productId,
        });
      }

      return purchaseList.length;
    } catch (error) {
      console.error('[RESTORE_PURCHASES_ERROR]', error);
      return 0;
    }
  }

  async endConnection() {
    try {
      await IAP.endConnection();
    } catch (error) {
      console.error('[IAP_END_CONNECTION_ERROR]', error);
    }
  }
}

export const subscriptionService = new SubscriptionService();