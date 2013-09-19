/*

  ## Histogram

  ### Parameters
  * auto_int :: Auto calculate data point interval?
  * resolution ::  If auto_int is enables, shoot for this many data points, rounding to
                    sane intervals
  * interval :: Datapoint interval in elasticsearch date math format (eg 1d, 1w, 1y, 5y)
  * fill :: Only applies to line charts. Level of area shading from 0-10
  * linewidth ::  Only applies to line charts. How thick the line should be in pixels
                  While the editor only exposes 0-10, this can be any numeric value.
                  Set to 0 and you'll get something like a scatter plot
  * timezone :: This isn't totally functional yet. Currently only supports browser and utc.
                browser will adjust the x-axis labels to match the timezone of the user's
                browser
  * spyable ::  Dislay the 'eye' icon that show the last elasticsearch query
  * zoomlinks :: Show the zoom links?
  * bars :: Show bars in the chart
  * stack :: Stack multiple queries. This generally a crappy way to represent things.
             You probably should just use a line chart without stacking
  * points :: Should circles at the data points on the chart
  * lines :: Line chart? Sweet.
  * legend :: Show the legend?
  * x-axis :: Show x-axis labels and grid lines
  * y-axis :: Show y-axis labels and grid lines
  * interactive :: Allow drag to select time range

*/
define([
  'angular',
  'app',
  'jquery',
  'underscore',
  'kbn',
  'moment',
  './timeSeries',

  'jquery.flot',
  'jquery.flot.pie',
  'jquery.flot.selection',
  'jquery.flot.time',
  'jquery.flot.stack'
],
function (angular, app, $, _, kbn, moment, timeSeries) {

  'use strict';

  var module = angular.module('kibana.panels.histogram', []);
  app.useModule(module);

  module.controller('histogram', function($scope, querySrv, dashboard, filterSrv) {
    $scope.panelMeta = {
      editorTabs : [
        {
          title:'Queries',
          src:'app/partials/querySelect.html'
        }
      ],
      status  : "Stable",
      description : "A bucketed time series chart of the current query or queries. Uses the "+
        "Elasticsearch date_histogram facet. If using time stamped indices this panel will query"+
        " them sequentially to attempt to apply the lighest possible load to your Elasticsearch cluster"
    };

    // Set and populate defaults
    var _d = {
      mode        : 'count',
      time_field  : '@timestamp',
      queries     : {
        mode        : 'all',
        ids         : []
      },
      value_field : null,
      auto_int    : true,
      resolution  : 100,
      interval    : '5m',
      fill        : 0,
      linewidth   : 3,
      timezone    : 'browser', // browser, utc or a standard timezone
      spyable     : true,
      zoomlinks   : true,
      bars        : true,
      stack       : true,
      points      : false,
      lines       : false,
      legend      : true,
      'x-axis'    : true,
      'y-axis'    : true,
      percentage  : false,
      interactive : true,
      tooltip     : {
        value_type: 'cumulative',
        query_as_alias: false
      },
      alias: "",
      stackCharts : [], //array of { mode: "count", value_field: "", alias: "", queryString: "", valueScript: "" }
      decimals: 0,
      decimalSeparator: ".",
      commaSeparator: ",",
      formatString: "{0}",
      queryString: null,
      valueScript: null,
      hits: true
    };

    _.defaults($scope.panel,_d);

    $scope.init = function() {
      $scope.$on('refresh',function(){
        $scope.get_data();
      });

      $scope.get_data();

    };

    $scope.addStackChart = function() {
      $scope.panel.stackCharts.push({ mode: $scope.panel.mode, value_field: "", alias: "", queryString: "", valueScript: "" });
      $scope.set_refresh(true);
    }

    $scope.getFacetInterval = function (interval) {
      var matches = interval.match(/(\d+)([Mwdhmsyq])/);
      switch (matches[2]) {
        case "M":
          return "month";
        case "q":
          return "quarter";
        default:
          return interval;
      }
    }

    $scope.buildFacet = function(id, mode, time_field, value_field, valueScript, interval, facetFilter) {
      var facet = $scope.ejs.DateHistogramFacet(id);
      
      if(mode === 'count') {
        facet = facet.field(time_field);
      } else {
        if(_.isNull(value_field)) {
          $scope.panel.error = "In " + mode + " mode, a field must be specified";
          return null;
        }

        facet = facet.keyField(time_field);

        if (valueScript != null && valueScript != "")
          facet = facet.valueScript(valueScript);
        else
          facet = facet.valueField(value_field);
      }
      facet = facet.interval($scope.getFacetInterval(interval)).facetFilter(facetFilter);
      return facet;
    }

    $scope.getStackChartById = function (id) {
      if (id == 0) return { mode: $scope.panel.mode, time_field: $scope.panel.time_field, value_field: $scope.panel.value_field, alias: $scope.panel.alias, queryString: $scope.panel.queries.queryString };
      id = id - 1;
      return (id >= 0 && id < $scope.panel.stackCharts.length) ? $scope.panel.stackCharts[id] : null;
    }

    $scope.hasStackCharts = function () {
      return $scope.panel.stackCharts.length > 0;
    }

    $scope.hasQueries = function () {
      return !($scope.panel.queries.mode == "none" || $scope.panel.queries.mode == "index");
    }

    $scope.getStackChartAlias = function (id) {
      var item = $scope.getStackChartById(id);
      if (item == null) return "";
    
      var result = item.alias;
      if (result != null && result != "") return result;

      var valueField = item.mode == "count" ? $scope.panel.time_field : item.value_field;
      if (valueField == null || valueField == "") valueField = $scope.panel.time_field;

      return item.mode + " " + valueField;
    }

    $scope.getQueryInfo = function (id) {
      if (!$scope.hasStackCharts())
      {
        var globalAlias = querySrv.list[id];
        var alias = $scope.getStackChartAlias(0);
        if (globalAlias.alias != null && globalAlias.alias != "") alias += " - " + globalAlias.alias;
        return { alias: alias, color: globalAlias.color };
      }
      else {
        return { alias: $scope.getStackChartAlias(id), color: querySrv.colorAt(parseInt(id)) };
      }
    }

    /**
     * The time range effecting the panel
     * @return {[type]} [description]
     */
    $scope.get_time_range = function () {
      var range = $scope.range = filterSrv.timeRange('min');
      return range;
    };

    $scope.get_interval = function () {
      var interval = $scope.panel.interval,
                      range;
      if ($scope.panel.auto_int) {
        range = $scope.get_time_range();
        if (range) {
          interval = kbn.secondsToHms(
            kbn.calculate_interval(range.from, range.to, $scope.panel.resolution, 0) / 1000
          );
        }
      }
      $scope.panel.interval = interval || '10m';
      return $scope.panel.interval;
    };

    /**
     * Fetch the data for a chunk of a queries results. Multiple segments occur when several indicies
     * need to be consulted (like timestamped logstash indicies)
     *
     * The results of this function are stored on the scope's data property. This property will be an
     * array of objects with the properties info, time_series, and hits. These objects are used in the
     * render_panel function to create the historgram.
     *
     * @param {number} segment   The segment count, (0 based)
     * @param {number} query_id  The id of the query, generated on the first run and passed back when
     *                            this call is made recursively for more segments
     */
    $scope.get_data = function(segment, query_id) {
      if (_.isUndefined(segment)) {
        segment = 0;
      }
      delete $scope.panel.error;

      // Make sure we have everything for the request to complete
      if(dashboard.indices.length === 0) {
        return;
      }
      var _range = $scope.get_time_range();
      var _interval = $scope.get_interval(_range);

      if ($scope.panel.auto_int) {
        $scope.panel.interval = kbn.secondsToHms(
          kbn.calculate_interval(_range.from,_range.to,$scope.panel.resolution,0)/1000);
      }

      $scope.panelMeta.loading = true;
      var request = $scope.ejs.Request().indices(dashboard.indices[segment]);

      if (!$scope.hasStackCharts() && $scope.hasQueries()) {
        $scope.panel.queries.ids = querySrv.idsByMode($scope.panel.queries);

        // Build the query
        _.each($scope.panel.queries.ids, function(id) {
          var facetFilter = querySrv.getFacetFilterByQueryId(filterSrv, id, [$scope.panel.queryString, $scope.panel.queries.queryString]);
          var facet = $scope.buildFacet(id, $scope.panel.mode, $scope.panel.time_field, $scope.panel.value_field, $scope.panel.valueScript, _interval, facetFilter);
          if (facet == null) return;
          request = request.facet(facet).size(0);
        });
      }
      else {
        var facetFilter = querySrv.getFacetFilter(filterSrv, $scope.panel.queries, [$scope.panel.queryString, $scope.panel.queries.queryString]);

        $scope.panel.queries.ids = [0];
        var facet = $scope.buildFacet(0, $scope.panel.mode, $scope.panel.time_field, $scope.panel.value_field, $scope.panel.valueScript, _interval, facetFilter);
        if (facet == null) return;
        request = request.facet(facet).size(0);

        var stackId = 1;
        _.each($scope.panel.stackCharts, function (item) {
          var qs = _.isUndefined(item.queryString) ? null : item.queryString;
          var filter = (qs == null || qs == "") ? facetFilter : querySrv.getFacetFilter(filterSrv, $scope.panel.queries, [qs, $scope.panel.queries.queryString]);
          var facet = $scope.buildFacet(stackId, item.mode, $scope.panel.time_field, item.value_field, item.valueScript, _interval, filter);
          if (facet == null) return;
          $scope.panel.queries.ids.push(stackId);
          stackId++;
          request = request.facet(facet).size(0);
        });
      }

      // Populate the inspector panel
      $scope.populate_modal(request);

      // Then run it
      var results = request.doSearch();

      // Populate scope when we have results
      results.then(function(results) {
        $scope.panelMeta.loading = false;
        if(segment === 0) {
          $scope.hits = 0;
          $scope.data = [];
          query_id = $scope.query_id = new Date().getTime();
        }

        // Check for error and abort if found
        if(!(_.isUndefined(results.error))) {
          $scope.panel.error = $scope.parse_error(results.error);
          return;
        }

        // Convert facet ids to numbers
        var facetIds = _.map(_.keys(results.facets),function(k){return parseInt(k, 10);});

        // Make sure we're still on the same query/queries
        if($scope.query_id === query_id && _.difference(facetIds, $scope.panel.queries.ids).length === 0) {

          var i = 0,
            time_series,
            hits;

          _.each($scope.panel.queries.ids, function(id) {
            var query_results = results.facets[id];
            // we need to initialize the data variable on the first run,
            // and when we are working on the first segment of the data.
            if(_.isUndefined($scope.data[i]) || segment === 0) {
              time_series = new timeSeries.ZeroFilled({
                interval: _interval,
                start_date: _range && _range.from,
                end_date: _range && _range.to,
                fill_style: 'minimal'
              });
              hits = 0;
            } else {
              time_series = $scope.data[i].time_series;
              hits = $scope.data[i].hits;
            }

            //get the right statistic for stacked charts
            var statisticField = $scope.panel.mode;
            if ($scope.hasStackCharts()) {
              var item = $scope.getStackChartById(id);
              if (item != null) statisticField = item.mode;
            }

            // push each entry into the time series, while incrementing counters
            _.each(query_results.entries, function(entry) {
              time_series.addValue(entry.time, entry[statisticField]);
              hits += entry.count; // The series level hits counter
              $scope.hits += entry.count; // Entire dataset level hits counter
            });
            $scope.data[i] = {
              info: $scope.getQueryInfo(id),
              time_series: time_series,
              hits: hits
            };

            i++;
          });

          // Tell the histogram directive to render.
          $scope.$emit('render');

          // If we still have segments left, get them
          if(segment < dashboard.indices.length-1) {
            $scope.get_data(segment+1,query_id);
          }
        }
      });
    };

    // function $scope.zoom
    // factor :: Zoom factor, so 0.5 = cuts timespan in half, 2 doubles timespan
    $scope.zoom = function(factor) {
      var _range = filterSrv.timeRange('min');
      var _timespan = (_range.to.valueOf() - _range.from.valueOf());
      var _center = _range.to.valueOf() - _timespan/2;

      var _to = (_center + (_timespan*factor)/2);
      var _from = (_center - (_timespan*factor)/2);

      // If we're not already looking into the future, don't.
      if(_to > Date.now() && _range.to < Date.now()) {
        var _offset = _to - Date.now();
        _from = _from - _offset;
        _to = Date.now();
      }

      if(factor > 1) {
        filterSrv.removeByType('time');
      }
      filterSrv.set({
        type:'time',
        from:moment.utc(_from),
        to:moment.utc(_to),
        field:$scope.panel.time_field
      });

      dashboard.refresh();

    };

    // I really don't like this function, too much dom manip. Break out into directive?
    $scope.populate_modal = function(request) {
      $scope.inspector = angular.toJson(JSON.parse(request.toString()),true);
    };

    $scope.set_refresh = function (state) {
      $scope.refresh = state;
    };

    $scope.close_edit = function() {
      if($scope.refresh) {
        $scope.get_data();
      }
      $scope.refresh =  false;
      $scope.$emit('render');
    };
  });

  module.directive('histogramChart', function(dashboard, filterSrv) {
    return {
      restrict: 'A',
      template: '<div></div>',
      link: function(scope, elem) {

        // Receive render events
        scope.$on('render',function(){
          render_panel();
        });

        // Re-render if the window is resized
        angular.element(window).bind('resize', function(){
          render_panel();
        });

        // Function for rendering panel
        function render_panel() {
          // IE doesn't work without this
          elem.css({height:scope.panel.height || scope.row.height});

          // Populate from the query service
          try {
            _.each(scope.data, function(series) {
              series.label = series.info.alias;
              series.color = series.info.color;
            });
          } catch(e) {return;}

          // Set barwidth based on specified interval
          var barwidth = kbn.interval_to_ms(scope.panel.interval);

          var stack = scope.panel.stack ? true : null;

          // Populate element
          try {
            var options = {
              legend: { show: false },
              series: {
                //stackpercent: scope.panel.stack ? scope.panel.percentage : false,
                stack: scope.panel.percentage ? null : stack,
                lines:  {
                  show: scope.panel.lines,
                  fill: scope.panel.fill/10,
                  lineWidth: scope.panel.linewidth,
                  steps: false
                },
                bars:   {
                  show: scope.panel.bars,
                  fill: 1,
                  barWidth: barwidth/1.8,
                  zero: false,
                  lineWidth: 0
                },
                points: {
                  show: scope.panel.points,
                  fill: 1,
                  fillColor: false,
                  radius: 5
                },
                shadowSize: 1
              },
              yaxis: {
                show: scope.panel['y-axis'],
                min: 0,
                max: scope.panel.percentage && scope.panel.stack ? 100 : null,
              },
              xaxis: {
                timezone: scope.panel.timezone,
                show: scope.panel['x-axis'],
                mode: "time",
                min: _.isUndefined(scope.range.from) ? null : scope.range.from.getTime(),
                max: _.isUndefined(scope.range.to) ? null : scope.range.to.getTime(),
                timeformat: time_format(scope.panel.interval),
                label: "Datetime",
              },
              grid: {
                backgroundColor: null,
                borderWidth: 0,
                hoverable: true,
                color: '#c8c8c8'
              }
            };

            if(scope.panel.interactive) {
              options.selection = { mode: "x", color: '#666' };
            }

            // when rendering stacked bars, we need to ensure each point that has data is zero-filled
            // so that the stacking happens in the proper order
            var required_times = [];
            if (scope.data.length > 1) {
              required_times = Array.prototype.concat.apply([], _.map(scope.data, function (query) {
                return query.time_series.getOrderedTimes();
              }));
              required_times = _.uniq(required_times.sort(function (a, b) {
                // decending numeric sort
                return a-b;
              }), true);
            }

            for (var i = 0; i < scope.data.length; i++) {
              scope.data[i].data = scope.data[i].time_series.getFlotPairs(required_times);
            }

            scope.plot = $.plot(elem, scope.data, options);

          } catch(e) {
            elem.text(e);
          }
        }

        function time_format(interval) {
          var _int = kbn.interval_to_seconds(interval);
          if(_int >= 2628000) {
            return "%m/%y";
          }
          if(_int >= 86400) {
            return "%m/%d/%y";
          }
          if(_int >= 60) {
            return "%H:%M<br>%m/%d";
          }

          return "%H:%M:%S";
        }

        function hover_time_format(interval) {
          var _int = kbn.interval_to_seconds(interval);
          if(_int >= 2628000) {
            return "MM/YYYY";
          }
          if(_int >= 86400) {
            return "MM/DD/YYYY";
          }
          if(_int >= 60) {
            return "HH:mm MM/DD";
          }
        
          return "MM/DD HH:mm:ss";
        }

        var $tooltip = $('<div>');
        elem.bind("plothover", function (event, pos, item) {
          var group, value;
          if (item) {
            require(['jquery.number'], function(){
              if (item.series.info.alias || scope.panel.tooltip.query_as_alias) {
                group = '<small style="font-size:0.9em;">' +
                  '<i class="icon-circle" style="color:'+item.series.color+';"></i>' + ' ' +
                  (item.series.info.alias || item.series.info.query)+
                '</small><br>';
              } else {
                group = kbn.query_color_dot(item.series.color, 15) + ' ';
              }
              if (scope.panel.stack && scope.panel.tooltip.value_type === 'individual')  {
                value = item.datapoint[1] - item.datapoint[2];
              } else {
                value = item.datapoint[1];
              }

              var formatted = $.number(value, scope.panel.decimals, scope.panel.decimalSeparator, scope.panel.commaSeparator);
              if (!_.isUndefined(scope.panel.formatString) && scope.panel.formatString != "")
                formatted = scope.panel.formatString.replace(/\{0\}/g, formatted);

              $tooltip
                .html(
                  group + formatted + " @ " + moment(item.datapoint[0]).format(hover_time_format(scope.get_interval()))
                )
                .place_tt(pos.pageX, pos.pageY);
            });
          } else {
            $tooltip.detach();
          }
        });

        elem.bind("plotselected", function (event, ranges) {
          filterSrv.set({
            type  : 'time',
            from  : moment.utc(ranges.xaxis.from),
            to    : moment.utc(ranges.xaxis.to),
            field : scope.panel.time_field
          });
          dashboard.refresh();
        });
      }
    };
  });

});