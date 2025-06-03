import { Decimal } from 'decimal.js';

interface OrderTypeWire {
  limit?: LimitOrderType;
  trigger?: TriggerOrderTypeWire;
}

interface TriggerOrderTypeWire {
  triggerPx: string;
  isMarket: boolean;
  tpsl: Tpsl;
}

type Tif = 'Alo' | 'Ioc' | 'Gtc';
type Tpsl = 'tp' | 'sl';

interface LimitOrderType {
  tif: Tif;
}

interface TriggerOrderType {
  triggerPx: number;
  isMarket: boolean;
  tpsl: Tpsl;
}

interface OrderType {
  limit?: LimitOrderType;
  trigger?: TriggerOrderType;
}

interface OrderWire {
  a: number;
  b: boolean;
  p: string;
  s: string;
  r: boolean;
  t: OrderTypeWire;
  c?: string;
}

export interface OrderRequest {
  asset: number;
  is_buy: boolean;
  sz: number;
  limit_px: number;
  order_type: OrderType;
  reduce_only: boolean;
  cloid?: any | null;
}

export function orderRequestToOrderWire(order: OrderRequest): OrderWire {
  const orderWire: OrderWire = {
    a: order.asset,
    b: order.is_buy,
    p: floatToWire(order.limit_px),
    s: floatToWire(order.sz),
    r: order.reduce_only,
    t: orderTypeToWire(order.order_type),
  };

  if (order.cloid) {
    orderWire.c = order.cloid.toRaw();
  }

  return orderWire;
}

export function orderWiresToOrderAction(orderWires: OrderWire[]) {
  return {
    type: 'order',
    orders: orderWires,
    grouping: 'na',
  };
}

function floatToWire(x: number): string {
  const rounded = x.toFixed(8);
  if (Math.abs(parseFloat(rounded) - x) >= 1e-12) {
    throw new Error('floatToWire causes rounding');
  }
  if (rounded === '-0') {
    return '0';
  }
  return new Decimal(rounded).toString();
}

function orderTypeToWire(orderType: OrderType): OrderTypeWire {
  if ('limit' in orderType) {
    return { limit: orderType.limit };
  } else if ('trigger' in orderType && orderType.trigger) {
    return {
      trigger: {
        isMarket: orderType.trigger.isMarket,
        triggerPx: floatToWire(orderType.trigger.triggerPx),
        tpsl: orderType.trigger.tpsl,
      },
    };
  }
  throw new Error('Invalid order type');
}
