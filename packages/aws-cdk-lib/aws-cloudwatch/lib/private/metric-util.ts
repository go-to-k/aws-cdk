import { Duration, UnscopedValidationError } from '../../../core';
import { MathExpression, SearchExpression } from '../metric';
import { IMetric, MetricConfig, MetricExpressionConfig, MetricStatConfig } from '../metric-types';

const METRICKEY_SYMBOL = Symbol('@aws-cdk/aws-cloudwatch.MetricKey');

/**
 * Return a unique string representation for this metric.
 *
 * Can be used to determine as a hash key to determine if 2 Metric objects
 * represent the same metric. Excludes rendering properties.
 */
export function metricKey(metric: IMetric): string {
  // Cache on the object itself. This is safe because Metric objects are immutable.
  if (metric.hasOwnProperty(METRICKEY_SYMBOL)) {
    return (metric as any)[METRICKEY_SYMBOL];
  }

  const parts = new Array<string>();

  const conf = metric.toMetricConfig();
  if (conf.mathExpression) {
    parts.push(conf.mathExpression.expression);
    for (const id of Object.keys(conf.mathExpression.usingMetrics).sort()) {
      parts.push(id);
      parts.push(metricKey(conf.mathExpression.usingMetrics[id]));
    }
    if (conf.mathExpression.searchRegion) {
      parts.push(conf.mathExpression.searchRegion);
    }
    if (conf.mathExpression.searchAccount) {
      parts.push(conf.mathExpression.searchAccount);
    }
  }
  if (conf.searchExpression) {
    parts.push(conf.searchExpression.expression);
    if (conf.searchExpression.searchRegion) {
      parts.push(conf.searchExpression.searchRegion);
    }
    if (conf.searchExpression.searchAccount) {
      parts.push(conf.searchExpression.searchAccount);
    }
  }
  if (conf.metricStat) {
    parts.push(conf.metricStat.namespace);
    parts.push(conf.metricStat.metricName);
    for (const dim of conf.metricStat.dimensions || []) {
      parts.push(dim.name);
      parts.push(dim.value);
    }
    if (conf.metricStat.statistic) {
      parts.push(conf.metricStat.statistic);
    }
    if (conf.metricStat.period) {
      parts.push(`${conf.metricStat.period.toSeconds()}`);
    }
    if (conf.metricStat.region) {
      parts.push(conf.metricStat.region);
    }
    if (conf.metricStat.account) {
      parts.push(conf.metricStat.account);
    }
  }

  const ret = parts.join('|');
  Object.defineProperty(metric, METRICKEY_SYMBOL, { value: ret });
  return ret;
}

/**
 * Return the period of a metric
 *
 * For a stat metric, return the immediate period.
 *
 * For a math expression metric, all metrics used in it have been made to have the
 * same period, so we return the period of the first inner metric.
 *
 * For a search expression metric, return the period of the search expression.
 */
export function metricPeriod(metric: IMetric): Duration {
  return dispatchMetric(metric, {
    withStat(stat) {
      return stat.period;
    },
    withMathExpression() {
      return (metric as MathExpression).period || Duration.minutes(5);
    },
    withSearchExpression() {
      return (metric as SearchExpression).period || Duration.minutes(5);
    },
  });
}

/**
 * Given a metric object, inspect it and call the correct function for the type of output
 *
 * In addition to the metric object itself, takes a callback object with three
 * methods, to be invoked for the particular type of metric.
 *
 * If the metric represent a metric query (nominally generated through an
 * instantiation of `Metric` but can be generated by any class that implements
 * `IMetric`) a particular field in its `toMetricConfig()` output will be set
 * (to wit, `metricStat`) and the `withStat()` callback will be called with
 * that object.
 *
 * If the metric represents a math expression (usually by instantiating `MathExpression`
 * but users can implement `IMetric` arbitrarily) the `mathExpression` field
 * will be set in the object returned from `toMetricConfig` and the callback
 * called `withMathExpression` will be applied to that object.
 *
 * If the metric represents a search expression (usually by instantiating `SearchExpression`
 * but users can implement `IMetric` arbitrarily) the `searchExpression` field
 * will be set in the object returned from `toMetricConfig` and the callback
 * called `withSearchExpression` will be applied to that object.
 *
 * Will return the values returned by the callbacks.
 *
 * To be used as such:
 *
 * ```ts
 * const ret = dispatchMetric(someMetric, {
 *   withStat(stat) {
 *     // do something with stat
 *     return 1;
 *   },
 *   withMathExpression(mathExpr) {
 *     // do something with math expression
 *     return 2;
 *   },
 *   withSearchExpression(searchExpr) {
 *     // do something with search expression
 *     return 3;
 *   },
 * });
 * ```
 *
 * This function encapsulates some type analysis that would otherwise have to be
 * repeated in all places where code needs to make a distinction on the type
 * of metric object that is being passed.
 */
// eslint-disable-next-line max-len
export function dispatchMetric<A, B, C>(metric: IMetric, fns: { withStat: (x: MetricStatConfig, c: MetricConfig) => A; withMathExpression: (x: MetricExpressionConfig, c: MetricConfig) => B; withSearchExpression: (x: MetricExpressionConfig, c: MetricConfig) => C }): A | B | C {
  const conf = metric.toMetricConfig();
  const typeCount = [conf.metricStat, conf.mathExpression, conf.searchExpression].map(Boolean).filter(Boolean).length;

  if (typeCount > 1) {
    throw new UnscopedValidationError('Metric object must not produce more than one of \'metricStat\', \'mathExpression\', or \'searchExpression\'');
  }
  if (conf.metricStat) {
    return fns.withStat(conf.metricStat, conf);
  } else if (conf.mathExpression) {
    return fns.withMathExpression(conf.mathExpression, conf);
  } else if (conf.searchExpression) {
    return fns.withSearchExpression(conf.searchExpression, conf);
  } else {
    throw new UnscopedValidationError('Metric object must have either \'metricStat\', \'mathExpression\', or \'searchExpression\'');
  }
}
