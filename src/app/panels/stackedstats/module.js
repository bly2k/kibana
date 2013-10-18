define([
  'angular',
  'app',
  'underscore',
  'jquery',
  'kbn'
],
function (angular, app, _, $, kbn) {
  'use strict';

  var module = angular.module('kibana.panels.stackedstats', []);
  app.useModule(module);

  module.controller('stackedstats', function($scope, querySrv, dashboard, filterSrv) {
    $scope.panelMeta = {
      modals : [
        {
          description: "Inspect",
          icon: "icon-info-sign",
          partial: "app/partials/inspector.html",
          show: $scope.panel.spyable
        }
      ],
      editorTabs : [
        {title:'Queries', src:'app/partials/querySelect.html'}
      ],
      status: "Stable",
      description: "Displays a stack of statistical aggregrations (count, total, avg, max, min, terms/distinct count, hits) of a numeric field."
    };

    var _d = {
      queries: {
        mode: 'all',
        ids: []
      },
      style   : { "font-size": '10pt'},
      donut   : false,
      tilt    : false,
      labels  : true,
      arrangement : 'horizontal',
      chart       : 'bar',
      counter_pos : 'above',
      stackCharts : [], //array of { statistic: "count", field: "@timestamp", alias: "", queryString: "", valueScript: "" }
      decimals: 0,
      decimalSeparator: ".",
      commaSeparator: ",",
      termsCountMax: 100000,
      formatString: "{0}",
      spyable : true,
      alias: null,
      valueAlias: null
    };

    _.defaults($scope.panel, _d);

    $scope.set_refresh = function (state)
    {
      $scope.refresh = state;
    };

    $scope.close_edit = function ()
    {
      if ($scope.refresh)
      {
        $scope.get_data();
      }
      $scope.refresh = false;
      $scope.$emit('render');
    };

    $scope.init = function ()
    {
      $scope.$on('render', function ()
      {
        $scope.$apply();
      });
      $scope.$on('refresh', function ()
      {
        $scope.get_data();
      });
      $scope.get_data();
    };

    $scope.addStackChart = function() {
      $scope.panel.stackCharts.push({ statistic: "count", field: null, alias: null, queryString: null, valueScript: null });
      $scope.set_refresh(true);
    }

    $scope.buildFacet = function(stackId, statistic, field, queryString, valueScript, facetFilter) {
      var facet = null;

      if (statistic != "hits" && (field == null || field == "")) {
        $scope.panel.error = "Field must be specified.";
        return null;
      }
      else if (statistic == "hits" && (queryString == null || queryString == ""))
      {
        $scope.panel.error = "Querystring must be specified.";
        return null;
      };

      switch (statistic) {
        case "termscount":
          facet = $scope.ejs.TermsFacet(stackId)
            .field(field)
            .size($scope.panel.termsCountMax);
          break;

        case "hits":
          var qs = (queryString != null || queryString != "") ? $scope.ejs.QueryStringQuery(queryString) : $scope.ejs.QueryStringQuery("*");
          facet = $scope.ejs.QueryFacet(stackId)
            .query(qs);
          break;

        case "count":
          facet = $scope.ejs.QueryFacet(stackId)
            .query($scope.ejs.QueryStringQuery(field + ":*"));
          break;

        default:
          facet = $scope.ejs.StatisticalFacet(stackId);

          if (valueScript != null && valueScript != "")
            facet = facet.script(valueScript);
          else
            facet = facet.field(field);

          break;
      }

      if (facet != null && facetFilter != null) 
        facet = facet.facetFilter(facetFilter);

      return facet;
    }

    $scope.getStatistic = function(facet, statistic) {
      var decimals = !_.isUndefined($scope.panel.decimals) ? $scope.panel.decimals : 0;
    
      var result = 0;
      switch (statistic) {
        case "termscount": 
          result = facet.terms.length;
          break;

        case "hits":
        case "count":
          result = facet.count;
          break;

        default:
          result = facet[statistic];
          break;
      }

      result = parseFloat($.number(result, decimals, ".", ""));
      return result;
    }

    $scope.getStatisticAlias = function() {
      if ($scope.panel.alias != null && $scope.panel.alias != "") 
        return $scope.panel.alias;
      return "Statistic";
    }

    $scope.getValueAlias = function() {
      if ($scope.panel.valueAlias != null && $scope.panel.valueAlias != "") 
        return $scope.panel.valueAlias;
      return "Value";
    }

    $scope.getStackAlias = function(stack) {
      var result = stack.alias;
      if (result == null || result == "") {
        result = stack.field != null && stack.field != "" ? stack.field : "";
        result += " " + stack.statistic;
        if (stack.queryString != null && stack.queryString != "") result += " (" + stack.queryString + ")";
      }
      return result;
    }

    $scope.get_data = function (segment, query_id)
    {
      delete $scope.panel.error;

      // Make sure we have everything for the request to complete
      if (dashboard.indices.length === 0) {
        return;
      }

      if ($scope.panel.chart == "ratio" || $scope.panel.chart == "percent")
        if ($scope.panel.stackCharts.length < 2) {
          $scope.panel.error = "Ratio/percent requires at least 2 stacked metrics.";
          return;
        }

      $scope.panelMeta.loading = true;

      var request = $scope.ejs.Request().indices(dashboard.indices);

      $scope.panel.queries.ids = [];

      var fq = querySrv.getFacetQuery(filterSrv, $scope.panel.queries, $scope.panel.queries.queryString);
      request = request.query(fq);

      var stackId = 0;
      _.each($scope.panel.stackCharts, function (item) {
        var facetFilter = null;
        if (!_.isUndefined(item.queryString) && !_.isNull(item.queryString) && item.queryString != "") 
          facetFilter = querySrv.getFacetFilter(filterSrv, $scope.panel.queries, item.queryString);
        var facet = $scope.buildFacet(stackId, item.statistic, item.field, item.queryString, item.valueScript, facetFilter);
        if (facet == null) return;
        $scope.panel.queries.ids.push(stackId);
        stackId++;
        request = request.facet(facet).size(0);
      });

      // Populate the inspector panel
      $scope.inspector = angular.toJson(JSON.parse(request.toString()),true);

      var results = request.doSearch();

      results.then(function (results) {
        $scope.panelMeta.loading = false;

        require(['jquery.number'], function() {
          var k = 0;
          $scope.data = [];

          switch ($scope.panel.chart) {
            case "ratio":
              var n = $scope.getStatistic(results.facets[$scope.panel.queries.ids[0]], $scope.panel.stackCharts[0].statistic);
              var d = $scope.getStatistic(results.facets[$scope.panel.queries.ids[1]], $scope.panel.stackCharts[1].statistic);
              var r = n / d;
              $scope.statistic = $scope.formatMetricValue(r);
              break;

            case "percent": 
              var n = $scope.getStatistic(results.facets[$scope.panel.queries.ids[0]], $scope.panel.stackCharts[0].statistic);
              var d = $scope.getStatistic(results.facets[$scope.panel.queries.ids[1]], $scope.panel.stackCharts[1].statistic);
              var r = 100 * (n / d);
              $scope.statistic = $scope.formatMetricValue(r);
              break;

            default:
              _.each($scope.panel.queries.ids, function(id) {
                var v = results.facets[id];
                var stack = $scope.panel.stackCharts[k];
                var value = $scope.getStatistic(v, stack.statistic);
                var label = $scope.getStackAlias(stack);
                var slice = { label : label, data : [[k,value]], actions: true}; 
                $scope.data.push(slice);
                k = k + 1;
              });
              break;
          }

          $scope.$emit('render');
        });
      });
    };

    $scope.formatMetricValue = function(metric) {
      var formatted = $.number(metric, $scope.panel.decimals, $scope.panel.decimalSeparator, $scope.panel.commaSeparator);
      if (!_.isUndefined($scope.panel.formatString) && $scope.panel.formatString != null && $scope.panel.formatString != "")
        formatted = $scope.panel.formatString.replace(/\{0\}/g, formatted);
      return formatted;
    }
  });
  
  module.directive('stackedStatsChart', function(querySrv, filterSrv, dashboard) {
    return {
      restrict: 'A',
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
          var plot, chartData;

          // IE doesn't work without this
          elem.css({height:scope.panel.height||scope.row.height});

          // Make a clone we can operate on.
          chartData = _.clone(scope.data);
          chartData = scope.panel.missing ? chartData : 
            _.without(chartData,_.findWhere(chartData,{meta:'missing'}));
          chartData = scope.panel.other ? chartData : 
          _.without(chartData,_.findWhere(chartData,{meta:'other'}));

          // Populate element.
          require(['jquery.flot.pie'], function(){
            // Populate element
            try {
              // Add plot to scope so we can build out own legend 
              if(scope.panel.chart === 'bar') {
                plot = $.plot(elem, chartData, {
                  legend: { show: false },
                  series: {
                    lines:  { show: false, },
                    bars:   { show: true,  fill: 1, barWidth: 0.8, horizontal: false },
                    shadowSize: 1
                  },
                  yaxis: { show: true, min: 0, color: "#c8c8c8" },
                  xaxis: { show: false },
                  grid: {
                    borderWidth: 0,
                    borderColor: '#eee',
                    color: "#eee",
                    hoverable: true,
                    clickable: true
                  },
                  colors: querySrv.colors
                });
              }
              if(scope.panel.chart === 'pie') {
                var labelFormat = function(label, series){
                  return '<div style="font-size:8pt;text-align:center;padding:2px;color:white;">'+
                    label+'<br/>'+Math.round(series.percent)+'%</div>';
                };

                plot = $.plot(elem, chartData, {
                  legend: { show: false },
                  series: {
                    pie: {
                      innerRadius: scope.panel.donut ? 0.4 : 0,
                      tilt: scope.panel.tilt ? 0.45 : 1,
                      radius: 1,
                      show: true,
                      combine: {
                        color: '#999',
                        label: 'The Rest'
                      },
                      stroke: {
                        width: 0
                      },
                      label: { 
                        show: scope.panel.labels,
                        radius: 2/3,
                        formatter: labelFormat,
                        threshold: 0.1 
                      }
                    }
                  },
                  //grid: { hoverable: true, clickable: true },
                  grid:   { hoverable: true, clickable: true },
                  colors: querySrv.colors
                });
              }

              // Populate legend
              if(elem.is(":visible")){
                //scripts.wait(function(){
                  scope.legend = plot.getData();
                  if(!scope.$$phase) {
                    scope.$apply();
                  }
                //});
              }
            } catch(e) {
              elem.text(e);
            }
          });
        }

        var $tooltip = $('<div>');
        elem.bind("plothover", function (event, pos, item) {
          if (item) {
            var value = scope.panel.chart === 'bar' ? item.datapoint[1] : item.datapoint[1][0][1];
            var formatted = scope.formatMetricValue(value);
            $tooltip
              .html(
                kbn.query_color_dot(item.series.color, 20) + ' ' +
                item.series.label + " (" + formatted +")"
              )
              .place_tt(pos.pageX, pos.pageY);
          } else {
            $tooltip.remove();
          }
        });

      }
    };
  });
});