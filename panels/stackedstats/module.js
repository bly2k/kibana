'use strict';

angular.module('kibana.stackedstats', [])
.controller('stackedstats', function ($scope, querySrv, dashboard, filterSrv)
{
  $scope.panelMeta = {
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
    spyable : true
  };

  _.defaults($scope.panel, _d);

  // I really don't like this function, too much dom manip. Break out into directive?
  $scope.populate_modal = function(request) {
    $scope.modal = {
      title: "Inspector",
      body : "<h5>Last Elasticsearch Query</h5><pre>"+
        'curl -XGET '+config.elasticsearch+'/'+dashboard.indices+"/_search?pretty -d'\n"+
        angular.toJson(JSON.parse(request.toString()),true)+
      "'</pre>", 
    }; 
  };

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

    switch (statistic)
    {
      case "termscount":
        facet = $scope.ejs.TermsFacet(stackId)
          .field(field)
          .facetFilter(facetFilter)
          .size($scope.panel.termsCountMax);
        break;

      case "hits":
        var qs = (queryString != null || queryString != "") ? $scope.ejs.QueryStringQuery(queryString) : $scope.ejs.QueryStringQuery("*");
        facet = $scope.ejs.QueryFacet(stackId)
          .query(qs)
          .facetFilter(facetFilter);
        break;

      case "count":
        facet = $scope.ejs.QueryFacet(stackId)
          .query($scope.ejs.QueryStringQuery(field + ":*"))
          .facetFilter(facetFilter);
        break;

      default:
        facet = $scope.ejs.StatisticalFacet(stackId)
          .facetFilter(facetFilter);

        if (valueScript != null && valueScript != "")
          facet = facet.script(valueScript);
        else
          facet = facet.field(field);

        break;
    }

    return facet;
  }

  $scope.getStatistic = function(facet, statistic) {
    var decimals = !_.isUndefined($scope.panel.decimals) ? $scope.panel.decimals : 0;
    
    var result = 0;
    switch (statistic)
    {
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
    if (dashboard.indices.length === 0 || $scope.panel.field == "") {
      return;
    }

    $scope.panelMeta.loading = true;

    var request = $scope.ejs.Request().indices(dashboard.indices);

    $scope.panel.queries.ids = [];

    var stackId = 0;
    _.each($scope.panel.stackCharts, function (item) {
      var facetFilter = querySrv.getFacetFilter(filterSrv, $scope.panel.queries, [$scope.panel.queries.queryString, item.queryString]);
      var facet = $scope.buildFacet(stackId, item.statistic, item.field, item.queryString, item.valueScript, facetFilter);
      if (facet == null) return;
      $scope.panel.queries.ids.push(stackId);
      stackId++;
      request = request.facet(facet).size(0);
    });

    // Populate the inspector panel
    $scope.populate_modal(request);

    var results = request.doSearch();

    results.then(function (results) {
      $scope.panelMeta.loading = false;

      var scripts = $LAB.script("common/lib/jquery.number.min.js");
      
      scripts.wait(function() {
        var k = 0;
        $scope.data = [];

        _.each($scope.panel.queries.ids, function(id) {
          var v = results.facets[id];
          var stack = $scope.panel.stackCharts[k];
          var value = $scope.getStatistic(v, stack.statistic);
          var label = $scope.getStackAlias(stack);
          var slice = { label : label, data : [[k,value]], actions: true}; 
          $scope.data.push(slice);
          k = k + 1;
        });

        $scope.$emit('render');
      });
    });
  };

  $scope.formatMetricLabel = function(metric) {
    var formatted = $.number(metric, $scope.panel.decimals, $scope.panel.decimalSeparator, $scope.panel.commaSeparator);
    if (!_.isUndefined($scope.panel.formatString) && $scope.panel.formatString != "")
      formatted = $scope.panel.formatString.replace(/\{0\}/g, formatted);
    return formatted;
  }
}).directive('stackedStatsChart', function(querySrv, filterSrv, dashboard) {
  return {
    restrict: 'A',
    link: function(scope, elem, attrs, ctrl) {

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
        var scripts = $LAB.script("common/lib/panels/jquery.flot.js").wait()
                          .script("common/lib/panels/jquery.flot.pie.js");

        // IE doesn't work without this
        elem.css({height:scope.panel.height||scope.row.height});

        // Make a clone we can operate on.
        chartData = _.clone(scope.data);
        chartData = scope.panel.missing ? chartData : 
          _.without(chartData,_.findWhere(chartData,{meta:'missing'}));
        chartData = scope.panel.other ? chartData : 
        _.without(chartData,_.findWhere(chartData,{meta:'other'}));

        // Populate element.
        scripts.wait(function(){
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
                return '<div ng-click="build_search(panel.field,\''+label+'\')'+
                  ' "style="font-size:8pt;text-align:center;padding:2px;color:white;">'+
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
              scripts.wait(function(){
                scope.legend = plot.getData();
                if(!scope.$$phase) {
                  scope.$apply();
                }
              });
            }

          } catch(e) {
            elem.text(e);
          }
        });
      }

      function tt(x, y, contents) {
        var tooltip = $('#pie-tooltip').length ? 
          $('#pie-tooltip') : $('<div id="pie-tooltip"></div>');
        //var tooltip = $('#pie-tooltip')
        tooltip.html(contents).css({
          position: 'absolute',
          top     : y + 5,
          left    : x + 5,
          color   : "#c8c8c8",
          padding : '10px',
          'font-size': '11pt',
          'font-weight' : 200,
          'background-color': '#1f1f1f',
          'border-radius': '5px',
        }).appendTo("body");
      }

      elem.bind("plothover", function (event, pos, item) {
        if (item) {
          var value = scope.panel.chart === 'bar' ? 
            item.datapoint[1] : item.datapoint[1][0][1];

          var formatted = scope.formatMetricLabel(value);

          tt(pos.pageX, pos.pageY,
            "<div style='vertical-align:middle;border-radius:10px;display:inline-block;background:"+
            item.series.color+";height:20px;width:20px'></div> "+item.series.label+
            " ("+formatted+")");
        } else {
          $("#pie-tooltip").remove();
        }
      });

    }
  };
});
