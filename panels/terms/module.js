/*jshint globalstrict:true */
/*global angular:true */

/*

  ## Terms

  ### Parameters
  * style :: A hash of css styles
  * size :: top N
  * arrangement :: How should I arrange the query results? 'horizontal' or 'vertical'
  * chart :: Show a chart? 'none', 'bar', 'pie'
  * donut :: Only applies to 'pie' charts. Punches a hole in the chart for some reason
  * tilt :: Only 'pie' charts. Janky 3D effect. Looks terrible 90% of the time. 
  * lables :: Only 'pie' charts. Labels on the pie?

*/

'use strict';

angular.module('kibana.terms', [])
.controller('terms', function($scope, querySrv, dashboard, filterSrv) {

  $scope.panelMeta = {
    editorTabs : [
      {title:'Queries', src:'partials/querySelect.html'}
    ],
    status  : "Beta",
    description : "Displays the results of an elasticsearch facet as a pie chart, bar chart, or a "+ 
      "table"
  };

  // Set and populate defaults
  var _d = {
    queries     : {
      mode        : 'all',
      ids         : []
    },
    field   : '_type',
    filterField: null,
    exclude : [],
    include : null,
    missing : true,
    other   : true,
    size    : 10,
    order   : 'count',
    style   : { "font-size": '10pt'},
    donut   : false,
    tilt    : false,
    labels  : true,
    arrangement : 'horizontal',
    chart       : 'bar',
    counter_pos : 'above',
    spyable     : true,
    mode: "count",
    valueField: "",
    decimals: 0,
    decimalSeparator: ".",
    commaSeparator: ",",
    formatString: "{0}",
    termScript: null,
    valueScript: null,
    alias: "",
    valueAlias: "",
    filterTerm: "",
    filterId: null
  };

  _.defaults($scope.panel,_d);

  $scope.init = function () {
    $scope.hits = 0;
   
    $scope.$on('refresh',function(){
      $scope.get_data();
    });
    $scope.get_data();

  };

  $scope.getFilterField = function() {
    var termFields = $scope.termFields();
    var result = $scope.panel.filterField != null && $scope.panel.filterField != "" ? $scope.panel.filterField : 
      (termFields.length == 1 ? $scope.panel.field : termFields);
    return result;
  }

  $scope.buildSelectFilter = function() {
    var deleted = $scope.panel.filterId != null ? filterSrv.remove($scope.panel.filterId) : false;
    $scope.panel.filterId = null;
    if ($scope.panel.filterTerm != null && $scope.panel.filterTerm != "") {
      var filterField = $scope.getFilterField();
      var termIsScript = $scope.panel.termScript != null && $scope.panel.termScript != "";
      if (termIsScript)
        $scope.panel.filterId = filterSrv.set({type: 'field', field: filterField, query: $scope.panel.filterTerm.toString(), mandate: 'must'});
      else
        $scope.panel.filterId = filterSrv.set({type: 'terms', field: filterField, value: $scope.panel.filterTerm, mandate: 'must'});
    }
    dashboard.refresh();
  }

  $scope.getStatisticLabel = function()
  {
    if ($scope.panel.valueAlias != null && $scope.panel.valueAlias != "") 
      return $scope.panel.valueAlias;
    var mode = $scope.panel.mode;
    return mode.charAt(0).toUpperCase() + mode.slice(1);
  }

  $scope.getFieldLabel = function()
  {
    if ($scope.panel.alias != null && $scope.panel.alias != "") 
      return $scope.panel.alias;
    var field = $scope.panel.field;
    return field.charAt(0).toUpperCase() + field.slice(1);
  }

  //an include expression can have "{filter:filterfield}" in it in which case we replace that {filter:filterfield} with the current value for that term/field filter
  $scope.evaluateIncludeExpression = function(include) {
    if (include == null || include == "") return include;

    var filterMatch = /.*\{filter:([a-zA-Z0-9_]+?)\}/i.exec(include);
    if (filterMatch != null) {
      var result = "";
      var field = filterMatch[1].toString();
      
      var termFilters = filterSrv.getByType("terms");
      _.each(termFilters, function(filter) {
        var filterField = filter.field.toLowerCase();
        if (filterField == field.toLowerCase()) {
          if (result != "") result += "|";
          result += filter.value;
        }
      });

      var fieldFilters = filterSrv.getByType("field");
      _.each(fieldFilters, function(filter) {
        var filterField = filter.field.toLowerCase();
        if (filterField == field.toLowerCase()) {
          if (result != "") result += "|";
          result += filter.query;
        }
      });

      if (result != "") result = "(" + result + ")";
      result = include.replace(new RegExp("\\{filter:" + field + "\\}", "gi"), result);
      return result;
    }

    return include;
  }

  $scope.termFields = function () {
    var result = $scope.panel.field.split(',');
    return result;
  }

  $scope.get_data = function(segment,query_id) {
    delete $scope.panel.error;

    // Make sure we have everything for the request to complete
    if(dashboard.indices.length === 0) {
      return;
    } 

    $scope.panelMeta.loading = true;

    var request = $scope.ejs.Request().indices(dashboard.indices);

    $scope.panel.queries.ids = querySrv.idsByMode($scope.panel.queries);

    var facetFilter = querySrv.getFacetFilter(filterSrv, $scope.panel.queries, $scope.panel.queries.queryString);

    var mode = $scope.panel.mode;

    switch (mode)
    {
      case "count":
        // Terms mode
        var termsFacet = $scope.ejs.TermsFacet('terms')
          .fields($scope.termFields())
          .size($scope.panel.size)
          .order($scope.panel.order)
          .exclude($scope.panel.exclude)
          .facetFilter(facetFilter);

        if ($scope.panel.include != null && $scope.panel.include != "")
          termsFacet = termsFacet.regex($scope.evaluateIncludeExpression($scope.panel.include));

        if ($scope.panel.termScript != null && $scope.panel.termScript != "")
          termsFacet = termsFacet.scriptField($scope.panel.termScript);

        request = request.facet(termsFacet).size(0);
        break;

      default:
        if ($scope.panel.valueField == "") {
          $scope.panel.error = "Value field must be specified.";
          return;
        }

        var tsFacet = $scope.ejs.TermStatsFacet('terms')
          .keyField($scope.panel.field)
          .size($scope.panel.size)
          .order($scope.panel.order)
          .facetFilter(facetFilter);

        if ($scope.panel.valueScript != null && $scope.panel.valueScript != "")
          tsFacet = tsFacet.valueScript($scope.panel.valueScript);
        else
          tsFacet = tsFacet.valueField($scope.panel.valueField);
      
        request = request.facet(tsFacet).size(0);
        break;
    }

    // Populate the inspector panel
    $scope.inspector = angular.toJson(JSON.parse(request.toString()),true);

    var results = request.doSearch();

    // Populate scope when we have results
    results.then(function(results) {
      var scripts = $LAB.script("common/lib/jquery.number.min.js");
            
      scripts.wait(function() {
        var k = 0;
        var valueField = mode;

        $scope.panelMeta.loading = false;
        $scope.hits = results.hits.total;
        $scope.data = [];

        _.each(results.facets.terms.terms, function(v) {
          var decimals = !_.isUndefined($scope.panel.decimals) ? $scope.panel.decimals : 0;
          var value = mode == "count" ? v[valueField] : parseFloat($.number(v[valueField], decimals, ".", ""));
          var slice = { label : v.term, data : [[k,value]], actions: true}; 
          $scope.data.push(slice);
          k = k + 1;
        });

        if (mode == "count") {
          if ($scope.panel.missing)
            $scope.data.push({label:'Missing field',
              data:[[k,results.facets.terms.missing]],meta:"missing",color:'#aaa',opacity:0});
          if ($scope.panel.other)
            $scope.data.push({label:'Other values',
              data:[[k+1,results.facets.terms.other]],meta:"other",color:'#444'});
        }

        $scope.$emit('render');
      });
    });
  };

  $scope.buildTermsQuery = function(fields, value) {
    var result = "";
    _.each(fields, function(field) {
      if (result != "") result += " OR ";
      result += "(" + field + ":\"" + value + "\")";
    });
    return result;
  }

  $scope.build_search = function(term,negate) {
    if (_.isUndefined(negate)) negate = false;
    var filterField = $scope.getFilterField();
    if(_.isUndefined(term.meta)) {
      var termIsScript = $scope.panel.termScript != null && $scope.panel.termScript != "";

      if (!_.isArray(filterField)) {
        if (termIsScript)
          filterSrv.set({type: 'field', field: filterField, query: term.label, mandate: (negate ? 'mustNot':'must')});
        else
          filterSrv.set({type:'terms', field: filterField, value: term.label, mandate: (negate ? 'mustNot':'must')});
      }
      else {
        if (termIsScript)
          filterSrv.set({type: 'querystring', query: $scope.buildTermsQuery(filterField, term.label), mandate: (negate ? 'mustNot':'must')});
        else
          filterSrv.set({type:'querystring', query: $scope.buildTermsQuery(filterField, term.label), mandate: (negate ? 'mustNot':'must')});
      }

    } else if(term.meta === 'missing') {
      filterSrv.set({type:'exists',field:filterField, mandate:(negate ? 'must':'mustNot')});
    } else {
      return;
    }
    dashboard.refresh();
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

  $scope.showMeta = function(term) {
    if(_.isUndefined(term.meta)) {
      return true;
    }
    if(term.meta === 'other' && !$scope.panel.other) {
      return false;
    }
    if(term.meta === 'missing' && !$scope.panel.missing) {
      return false;
    }
    return true;
  };

  $scope.formatMetricValue = function(metric) {
    var formatted = $.number(metric, $scope.panel.decimals, $scope.panel.decimalSeparator, $scope.panel.commaSeparator);
    if (!_.isUndefined($scope.panel.formatString) && $scope.panel.formatString != null && $scope.panel.formatString != "")
      formatted = $scope.panel.formatString.replace(/\{0\}/g, formatted);
    return formatted;
  }

}).directive('termsChart', function(querySrv, filterSrv, dashboard) {
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

      elem.bind("plotclick", function (event, pos, object) {
        if(object) {
          scope.build_search(scope.data[object.seriesIndex]);
        }
      });

      elem.bind("plothover", function (event, pos, item) {
        if (item) {
          var value = scope.panel.chart === 'bar' ? 
            item.datapoint[1] : item.datapoint[1][0][1];

          var formatted = scope.formatMetricValue(value);

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
