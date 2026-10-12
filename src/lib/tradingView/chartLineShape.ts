import type {
  DrawingEventType,
  EntityId,
  IChartWidgetApi,
  IChartingLibraryWidget,
  ILineDataSourceApi,
} from 'public/tradingview/charting_library';

export type ChartLineStyle = {
  lineColor: string;
  textColor: string;
  lineStyle: 'solid' | 'dotted' | 'dashed';
};

// The library's line style enum: 0 solid, 1 dotted, 2 dashed, 3 large dashed.
const LINE_STYLES = { solid: 0, dotted: 1, dashed: 2 } as const;

type HorizontalLineOverrides = {
  linecolor: string;
  linewidth: number;
  linestyle: number;
  textcolor: string;
  fontsize: number;
  bold: boolean;
  horzLabelsAlign: 'left' | 'center' | 'right';
  vertLabelsAlign: 'top' | 'middle' | 'bottom';
  showPrice: boolean;
};

/**
 * A horizontal price line on the chart for an order or a position.
 *
 * Advanced Charts dropped createOrderLine and createPositionLine in v29 (they are Trading
 * Platform only now), so the line is a `horizontal_line` drawing whose label carries the
 * text and the quantity. The drawing is created asynchronously; every update is queued
 * behind its creation so callers can treat the line as ready from construction. Drags and
 * deletions by the user arrive through the widget's drawing events, keyed by entity id.
 */
export class ChartLineShape {
  private readonly chart: IChartWidgetApi;

  private readonly ready: Promise<ILineDataSourceApi | null>;

  private id: EntityId | null = null;

  private removed = false;

  private gone = false;

  private price: number;

  private quantity: string;

  private text: string;

  private readonly time: number;

  private moveCallback: (() => void) | null = null;

  constructor(
    private readonly widget: IChartingLibraryWidget,
    {
      price,
      quantity,
      text,
      style,
      movable,
    }: {
      price: number;
      quantity: string;
      text: string;
      style: ChartLineStyle;
      movable: boolean;
    }
  ) {
    this.chart = widget.activeChart();
    this.price = price;
    this.quantity = quantity;
    this.text = text;
    // A horizontal line spans the whole pane; its time point only has to be a valid timestamp.
    this.time = Math.floor(Date.now() / 1000);

    widget.subscribe('drawing_event', this.onDrawingEvent);

    this.ready = this.chart
      .createShape<Partial<HorizontalLineOverrides>>(
        { time: this.time, price },
        {
          shape: 'horizontal_line',
          text: this.label(),
          lock: !movable,
          disableSelection: !movable,
          // Never persist these into the saved chart layout: they follow the account's live state.
          disableSave: true,
          disableUndo: true,
          showInObjectsTree: false,
          zOrder: 'top',
          overrides: {
            linecolor: style.lineColor,
            linewidth: 1,
            linestyle: LINE_STYLES[style.lineStyle],
            textcolor: style.textColor,
            fontsize: 10,
            bold: true,
            horzLabelsAlign: 'right',
            vertLabelsAlign: 'top',
            showPrice: true,
          },
        }
      )
      .then((id) => {
        if (this.removed) {
          this.chart.removeEntity(id, { disableUndo: true });
          return null;
        }
        this.id = id;
        return this.chart.getShapeById(id);
      })
      .catch(() => null);
  }

  getPrice() {
    return this.price;
  }

  setPrice(price: number) {
    if (price === this.price) return this;
    this.price = price;
    this.apply((api) => api.setPoints([{ time: this.time, price }]));
    return this;
  }

  getQuantity() {
    return this.quantity;
  }

  setQuantity(quantity: string) {
    if (quantity === this.quantity) return this;
    this.quantity = quantity;
    this.relabel();
    return this;
  }

  setText(text: string) {
    if (text === this.text) return this;
    this.text = text;
    this.relabel();
    return this;
  }

  setStyle({ lineColor, textColor, lineStyle }: ChartLineStyle) {
    this.apply((api) =>
      api.setProperties({
        linecolor: lineColor,
        textcolor: textColor,
        linestyle: LINE_STYLES[lineStyle],
      })
    );
    return this;
  }

  /** Runs after the user drags the line to a new price; getPrice() then returns that price. */
  onMove(callback: () => void) {
    this.moveCallback = callback;
    return this;
  }

  /** True once the user deleted the drawing from the chart; the owner should draw a fresh one. */
  isGone() {
    return this.gone;
  }

  remove() {
    this.removed = true;
    this.widget.unsubscribe('drawing_event', this.onDrawingEvent);
    this.ready
      .then((api) => {
        if (api == null || this.id == null || this.gone) return;
        this.chart.removeEntity(this.id, { disableUndo: true });
      })
      .catch(() => {
        // The chart may already be disposed; nothing is left to remove then.
      });
  }

  private readonly onDrawingEvent = (sourceId: EntityId, eventType: DrawingEventType) => {
    if (this.id == null || sourceId !== this.id) return;

    if (eventType === 'remove') {
      this.gone = true;
      this.widget.unsubscribe('drawing_event', this.onDrawingEvent);
      return;
    }

    if (eventType === 'move') {
      let moved: number | undefined;
      try {
        moved = this.chart.getShapeById(this.id).getPoints()[0]?.price;
      } catch {
        return;
      }
      // setPrice() records the price before it moves the drawing, so only a user's drag differs here.
      if (moved != null && moved !== this.price) {
        this.price = moved;
        this.moveCallback?.();
      }
    }
  };

  private label() {
    return `${this.text} ${this.quantity}`;
  }

  private relabel() {
    this.apply((api) => api.setProperties({ text: this.label() }));
  }

  private apply(update: (api: ILineDataSourceApi) => void) {
    this.ready
      .then((api) => {
        if (api == null || this.removed || this.gone) return;
        update(api);
      })
      .catch(() => {
        // The drawing was removed by the user or the chart was disposed; the next sync redraws it.
      });
  }
}
